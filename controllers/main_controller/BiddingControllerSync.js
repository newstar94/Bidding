export function setupAutoSyncBackground() {
    const checkAndSync = () => {
        this.forceSyncData(true).catch(err => console.error("Auto sync failed:", err));
    };

    // Check on window focus (user switches tab or returns to app)
    window.addEventListener('focus', checkAndSync);

    // Initialize WebSocket connection
    this.setupWebSocketConnection();
}


export function autoSync() {
    const deletions = JSON.parse(localStorage.getItem('bf_local_deletions') || '[]');
    const clientMutationId = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
        ...this.model.state,
        clientMutationId,
        deletions: deletions
    };
    return fetch('/api/sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Active-Org': encodeURIComponent(localStorage.getItem('bf_active_org') || '')
        },
        body: JSON.stringify(payload)
    })
        .then(res => {
            // Luôn đọc JSON dù response ok hay lỗi để có thể lấy validation_errors
            return res.json().then(data => ({ ok: res.ok, status: res.status, data }));
        })
        .then(({ ok, status, data }) => {
            // Xử lý lỗi validation từ server (status 400)
            if (!ok || data.status === 'error') {
                if (Array.isArray(data.errors) && data.errors.length > 0) {
                    const TABLE_LABELS = {
                        'chu_dau_tu': 'Chủ đầu tư',
                        'ke_hoach_lcnt': 'Kế hoạch LCNT',
                        'goi_thau': 'Gói thầu',
                        'nha_thau': 'Nhà thầu',
                        'chuyen_gia': 'Chuyên gia',
                        'hop_dong': 'Hợp đồng',
                        'thong_tin_mo_thau': 'Thông tin mở thầu'
                    };

                    // Nhóm lỗi theo loại (thiếu trường, sai định dạng, sai logic, trùng lặp)
                    const categorized = {
                        missing: [],
                        format: [],
                        logic: [],
                        duplicate: []
                    };

                    data.errors.forEach(err => {
                        const msg = err.message || '';
                        if (msg.includes('không được để trống')) {
                            categorized.missing.push(msg);
                        } else if (msg.includes('định dạng') || msg.includes('không đúng')) {
                            categorized.format.push(msg);
                        } else if (msg.includes('phải sau') || msg.includes('phải bằng') || msg.includes('phải nằm') || msg.includes('không được nhỏ')) {
                            categorized.logic.push(msg);
                        } else if (msg.includes('đã tồn tại')) {
                            categorized.duplicate.push(msg);
                        } else {
                            categorized.format.push(msg);
                        }
                    });

                    let msgLines = ['⚠️ Phát hiện lỗi dữ liệu, không thể đồng bộ:\n'];

                    if (categorized.missing.length > 0) {
                        msgLines.push('❌ THIẾU THÔNG TIN BẮT BUỘC:');
                        categorized.missing.forEach(m => msgLines.push('  • ' + m));
                        msgLines.push('');
                    }
                    if (categorized.format.length > 0) {
                        msgLines.push('📋 SAI ĐỊNH DẠNG:');
                        categorized.format.forEach(m => msgLines.push('  • ' + m));
                        msgLines.push('');
                    }
                    if (categorized.logic.length > 0) {
                        msgLines.push('⚡ SAI LOGIC NGHIỆP VỤ:');
                        categorized.logic.forEach(m => msgLines.push('  • ' + m));
                        msgLines.push('');
                    }
                    if (categorized.duplicate.length > 0) {
                        msgLines.push('🔁 DỮ LIỆU BỊ TRÙNG LẶP:');
                        categorized.duplicate.forEach(m => msgLines.push('  • ' + m));
                    }

                    const fullMsg = msgLines.join('\n');
                    console.error('[Sync Error]\n' + fullMsg, data.errors);
                } else {
                    console.error('[Sync Error]', data.error || data.message || 'Đồng bộ thất bại');
                }
                return;
            }

            if (data.timestamp) {
                localStorage.setItem('bf_last_sync_timestamp', data.timestamp);
                localStorage.removeItem('bf_local_deletions');
            }
            if (data.syncVersion !== undefined && data.syncVersion !== null) {
                localStorage.setItem('bf_last_sync_version', data.syncVersion.toString());
            }
            // Xóa các record mồ côi (parent đã bị xóa trên server) khỏi local state
            if (Array.isArray(data.orphanedIds) && data.orphanedIds.length > 0) {
                let stateChanged = false;
                for (const orphan of data.orphanedIds) {
                    const { table, id } = orphan;
                    // Map table_name -> state key
                    const tableToStateKey = {
                        'thong_tin_mo_thau': 'thongtinmothau',
                        'phan_cong_nhan_su': 'assignments',
                        'hop_dong_goi_thau': null, // junction table, no direct state key
                    };
                    const stateKey = tableToStateKey.hasOwnProperty(table) ? tableToStateKey[table] : table;
                    if (stateKey && Array.isArray(this.model.state[stateKey])) {
                        const before = this.model.state[stateKey].length;
                        this.model.state[stateKey] = this.model.state[stateKey].filter(item => String(item.id) !== String(id));
                        if (this.model.state[stateKey].length < before) {
                            this.model.persistData(stateKey);
                            stateChanged = true;
                        }
                    }
                }
                if (stateChanged) {
                    console.info(`[Sync] Đã xóa ${data.orphanedIds.length} record mồ côi khỏi IndexedDB:`, data.orphanedIds);
                }
            }
        })
        .catch(err => console.error("Error auto sync:", err));
}


export async function forceSyncData(isBackground = false, forceFull = false) {
    const syncBtn = document.getElementById('btn-force-sync');
    const syncIcon = document.getElementById('sync-icon');
    const syncStatusText = document.getElementById('sync-status-text');

    if (syncIcon) syncIcon.classList.add('anim-spin');
    if (syncStatusText) syncStatusText.textContent = 'Đang đồng bộ...';
    const hasLocalDataForCurrentRoute = typeof this.hasLocalDataForRoute === 'function'
        ? this.hasLocalDataForRoute(window.location.pathname)
        : (typeof this.hasLocalWorkspaceData === 'function' ? this.hasLocalWorkspaceData() : false);
    const shouldShowFullLoader = !isBackground && !hasLocalDataForCurrentRoute && this.view && this.view.showLoader;
    if (shouldShowFullLoader) this.view.showLoader();

    try {
        if (isBackground && this.model && typeof this.model.ensureAllDataLoaded === 'function') {
            await this.model.ensureAllDataLoaded();
        }
        const lastSyncVersion = localStorage.getItem('bf_last_sync_version');
        const useVersionDelta = !forceFull && lastSyncVersion !== null && lastSyncVersion !== '';
        const since = forceFull ? '0' : (localStorage.getItem('bf_last_sync_timestamp') || '0');
        const syncQuery = useVersionDelta
            ? `after_version=${encodeURIComponent(lastSyncVersion)}`
            : `since=${encodeURIComponent(since)}`;
        const response = await fetch('/api/get-all-data?' + syncQuery, {
            headers: {
                'X-Active-Org': encodeURIComponent(localStorage.getItem('bf_active_org') || '')
            }
        });
        if (response.ok) {
            const dbData = await response.json();

            const metadataKeys = new Set(['deletions', 'useServerSidePagination', 'timestamp', 'paginatedKeys', 'syncVersion']);
            const paginatedKeys = new Set(dbData.paginatedKeys || []);
            const useServerSidePagination = !!dbData.useServerSidePagination;
            this.model.useServerSidePagination = useServerSidePagination;
            const changedKeys = new Set();

            const mergeIncomingRecords = (key, incoming) => {
                if (!Array.isArray(this.model.state[key])) {
                    this.model.state[key] = [];
                }

                incoming.forEach(item => {
                    const idx = this.model.state[key].findIndex(x => String(x.id) === String(item.id));
                    if (idx !== -1) {
                        this.model.state[key][idx] = item;
                    } else {
                        this.model.state[key].push(item);
                    }
                });
            };

            const shouldSkipEmptyPaginatedStore = (key, incoming) => {
                return useServerSidePagination
                    && paginatedKeys.has(key)
                    && Array.isArray(incoming)
                    && incoming.length === 0
                    && Array.isArray(this.model.state[key])
                    && this.model.state[key].length > 0;
            };

            if (!useVersionDelta && since === '0') {
                Object.keys(dbData).forEach(key => {
                    if (metadataKeys.has(key) || !Array.isArray(dbData[key])) return;

                    const incoming = dbData[key];
                    if (shouldSkipEmptyPaginatedStore(key, incoming)) {
                        console.info(`[Sync] Skipped empty paginated store "${key}" to preserve local cache.`);
                        return;
                    }

                    this.model.state[key] = incoming;
                    changedKeys.add(key);
                    this.model.persistData(key);
                });
            } else {
                Object.keys(dbData).forEach(key => {
                    if (metadataKeys.has(key) || !Array.isArray(dbData[key])) return;

                    const incoming = dbData[key];
                    if (incoming.length === 0) return;

                    mergeIncomingRecords(key, incoming);
                    changedKeys.add(key);
                    if (this.model.db && typeof this.model.db.putRecords === 'function') {
                        this.model.db.putRecords(key, incoming).catch(e => console.error("Error storing records", e));
                    } else {
                        this.model.persistData(key);
                    }
                });

                const deletions = dbData.deletions || [];
                const deletionsByTable = {};
                deletions.forEach(del => {
                    const key = del.table;
                    const id = del.id;
                    if (this.model.state[key]) {
                        this.model.state[key] = this.model.state[key].filter(x => x.id !== id);
                        changedKeys.add(key);
                        if (!deletionsByTable[key]) {
                            deletionsByTable[key] = [];
                        }
                        deletionsByTable[key].push(id);
                    }
                });
                Object.keys(deletionsByTable).forEach(key => {
                    if (deletionsByTable[key].length > 0) {
                        this.model.db.deleteRecords(key, deletionsByTable[key]).catch(e => console.error("Error deleting records", e));
                    }
                });
            }

            if (dbData.syncVersion !== undefined && dbData.syncVersion !== null) {
                localStorage.setItem('bf_last_sync_version', dbData.syncVersion.toString());
            }
            if (dbData.timestamp) {
                localStorage.setItem('bf_last_sync_timestamp', dbData.timestamp.toString());
            }
            localStorage.setItem('bf_last_fetch_time', Date.now().toString());
            if (since === '0' && localStorage.getItem('bf_pending_full_resync_versions_v3') === 'true') {
                localStorage.setItem('bf_force_full_resync_versions_v3', 'true');
                localStorage.removeItem('bf_pending_full_resync_versions_v3');
            }

            if (!isBackground) {
                const renderIfChanged = (keys, renderFn) => {
                    if (keys.some(key => changedKeys.has(key)) && typeof renderFn === 'function') {
                        renderFn.call(this.view);
                    }
                };
                renderIfChanged(['kehoach', 'goithau', 'chudautu', 'nhathau', 'chuyengia', 'hopdong', 'assignments', 'thongtinmothau'], this.view.renderDashboard);
                renderIfChanged(['kehoach', 'chudautu', 'goithau'], this.view.renderKeHoachTable);
                renderIfChanged(['goithau', 'kehoach', 'chudautu', 'nhathau', 'thongtinmothau', 'assignments'], this.view.renderGoiThauTable);
                renderIfChanged(['chudautu', 'kehoach'], this.view.renderChuDauTuTable);
                renderIfChanged(['nhathau', 'goithau', 'hopdong', 'thongtinmothau'], this.view.renderNhaThauTable);
                renderIfChanged(['chuyengia', 'assignments'], this.view.renderChuyenGiaTable);
                renderIfChanged(['hopdong', 'goithau', 'nhathau', 'chudautu'], this.view.renderHopDongTable);
            }

            this.updateSyncStatusDisplay(Date.now());

            if (!isBackground) {
                // Re-evaluate URL mapping to replace raw ID/code with database item now that data has loaded
                const cleanPath = window.location.pathname.startsWith('/') ? window.location.pathname.substring(1) : window.location.pathname;
                const parts = cleanPath.split('/').filter(Boolean);
                const urlTab = parts[0] || '';
                const detailTabs = ['goithau-detail', 'kehoach-detail', 'hopdong-detail', 'chudautu-detail', 'nhathau-detail'];
                const isDetailTab = detailTabs.some(t => this.routeMap[t] === urlTab);
                if (isDetailTab && parts[1]) {
                    this.handlePathRouting(window.location.pathname, false, true);
                }
            }
        }
    } catch (err) {
        console.error("Failed to sync data from SQLite:", err);
        if (syncStatusText) syncStatusText.textContent = 'Lỗi đồng bộ';

        const banner = document.getElementById('offline-indicator-banner');
        if (banner) {
            banner.innerHTML = `<i data-lucide="alert-triangle"></i> Lỗi đồng bộ. Máy chủ không phản hồi.`;
            if (window.lucide) {
                window.lucide.createIcons({ root: banner });
            }
            banner.classList.add('visible');
            setTimeout(() => {
                if (navigator.onLine) {
                    banner.classList.remove('visible');
                } else {
                    banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
                    if (window.lucide) {
                        window.lucide.createIcons({ root: banner });
                    }
                }
            }, 5000);
        }
    } finally {
        if (syncIcon) syncIcon.classList.remove('anim-spin');
        if (shouldShowFullLoader && this.view && this.view.hideLoader) this.view.hideLoader();
    }
}


export function updateSyncStatusDisplay(timestamp) {
    const syncStatusText = document.getElementById('sync-status-text');
    if (!syncStatusText) return;
    const timeStr = new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    syncStatusText.textContent = `Đồng bộ (${timeStr})`;
}


export function setupWebSocketConnection() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/sync`;
    const debug = window.__BF_APP_DEBUG__ === true;

    if (debug) console.log("Connecting to WebSocket sync server:", wsUrl);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
        if (debug) console.log("WebSocket connection established. Sending auth...");
        // Reset backoff khi kết nối thành công
        this._wsRetryDelay = 5000;
        ws.send(JSON.stringify({
            action: "auth"
        }));
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.event === "db_changed") {
                if (debug) console.log("Database changed event received from WebSocket. Triggering Delta Sync...");
                this.forceSyncData(true).catch(err => console.error("Real-time sync failed:", err));
            }
        } catch (e) {
            console.error("Error handling WebSocket message:", e);
        }
    };

    ws.onclose = (event) => {
        // Exponential backoff: 5s → 7.5s → 11.25s → ... tối đa 60s
        const currentDelay = this._wsRetryDelay || 5000;
        const nextDelay = Math.min(60000, Math.round(currentDelay * 1.5));
        this._wsRetryDelay = nextDelay;
        if (debug) console.log(`WebSocket connection closed (code: ${event.code || 'unknown'}, reason: ${event.reason || 'none'}). Reconnecting in ${Math.round(nextDelay / 1000)}s...`);
        setTimeout(() => this.setupWebSocketConnection(), nextDelay);
    };

    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        ws.close();
    };
}

