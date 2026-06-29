export function setupAutoSyncBackground() {
    const checkAndSync = () => {
        const token = sessionStorage.getItem('bf_session_token');
        const username = sessionStorage.getItem('bf_username');
        if (!token || !username) return; // Only sync if logged in

        console.log("Triggering automatic background delta sync...");
        this.forceSyncData(true).catch(err => console.error("Auto sync failed:", err));
    };

    // Check every 30 seconds
    // setInterval(checkAndSync, 30000); // Tắt cơ chế polling tự động 30 giây

    // Check on window focus (user switches tab or returns to app)
    window.addEventListener('focus', checkAndSync);

    // Initialize WebSocket connection
    this.setupWebSocketConnection();
}


export function autoSync() {
    const self = this;
    const deletions = JSON.parse(localStorage.getItem('bf_local_deletions') || '[]');
    const payload = {
        ...this.model.state,
        deletions: deletions
    };
    return fetch('/api/sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
            'X-Username': sessionStorage.getItem('bf_username') || '',
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
                    // if (self.view && typeof self.view.customAlert === 'function') {
                    //     self.view.customAlert('Lỗi lưu dữ liệu', fullMsg, 'x-circle');
                    // }
                } else {
                    console.error('[Sync Error]', data.error || data.message || 'Đồng bộ thất bại');
                }
                return;
            }

            if (data.timestamp) {
                localStorage.setItem('bf_last_sync_timestamp', data.timestamp);
                localStorage.removeItem('bf_local_deletions');
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


export async function forceSyncData(isBackground = false) {
    const syncBtn = document.getElementById('btn-force-sync');
    const syncIcon = document.getElementById('sync-icon');
    const syncStatusText = document.getElementById('sync-status-text');

    if (syncIcon) syncIcon.classList.add('anim-spin');
    if (syncStatusText) syncStatusText.textContent = 'Đang đồng bộ...';

    try {
        const since = localStorage.getItem('bf_last_sync_timestamp') || '0';
        const response = await fetch('/api/get-all-data?since=' + since, {
            headers: {
                'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                'X-Username': sessionStorage.getItem('bf_username') || '',
                'X-Active-Org': encodeURIComponent(localStorage.getItem('bf_active_org') || '')
            }
        });
        if (response.ok) {
            const dbData = await response.json();

            this.model.useServerSidePagination = !!dbData.useServerSidePagination;

            if (since === '0' || dbData.useServerSidePagination) {
                Object.keys(dbData).forEach(key => {
                    if (key !== 'deletions' && key !== 'useServerSidePagination' && key !== 'timestamp') {
                        this.model.state[key] = dbData[key];
                        this.model.persistData(key);
                    }
                });
            } else {
                Object.keys(dbData).forEach(key => {
                    if (key !== 'deletions' && key !== 'useServerSidePagination' && key !== 'timestamp' && Array.isArray(dbData[key])) {
                        const incoming = dbData[key];
                        incoming.forEach(item => {
                            const idx = this.model.state[key].findIndex(x => x.id === item.id);
                            if (idx !== -1) {
                                this.model.state[key][idx] = item;
                            } else {
                                this.model.state[key].push(item);
                            }
                        });
                        if (incoming.length > 0) {
                            this.model.db.putRecords(key, incoming).catch(e => console.error("Error storing records", e));
                        }
                    }
                });

                const deletions = dbData.deletions || [];
                const deletionsByTable = {};
                deletions.forEach(del => {
                    const key = del.table;
                    const id = del.id;
                    if (this.model.state[key]) {
                        this.model.state[key] = this.model.state[key].filter(x => x.id !== id);
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

            if (dbData.timestamp) {
                localStorage.setItem('bf_last_sync_timestamp', dbData.timestamp.toString());
            }
            localStorage.setItem('bf_last_fetch_time', Date.now().toString());

            if (!isBackground) {
                // Trigger immediate UI updates
                this.view.renderDashboard();
                this.view.renderKeHoachTable();
                this.view.renderGoiThauTable();
                this.view.renderChuDauTuTable();
                this.view.renderNhaThauTable();
                this.view.renderChuyenGiaTable();
                this.view.renderHopDongTable();
            }

            this.updateSyncStatusDisplay(Date.now());

            if (!isBackground) {
                // Re-evaluate URL mapping to replace raw ID with maGoiThau now that database data has loaded
                const cleanPath = window.location.pathname.startsWith('/') ? window.location.pathname.substring(1) : window.location.pathname;
                const parts = cleanPath.split('/').filter(Boolean);
                const urlTab = parts[0] || '';
                if (this.routeMap['goithau-detail'] === urlTab && parts[1]) {
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
    }
}


export function updateSyncStatusDisplay(timestamp) {
    const syncStatusText = document.getElementById('sync-status-text');
    if (!syncStatusText) return;
    const timeStr = new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    syncStatusText.textContent = `Đồng bộ (${timeStr})`;
}


export function setupWebSocketConnection() {
    const token = sessionStorage.getItem('bf_session_token');
    const username = sessionStorage.getItem('bf_username');
    if (!token || !username) return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/sync`;

    console.log("Connecting to WebSocket sync server:", wsUrl);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
        console.log("WebSocket connection established. Sending auth...");
        ws.send(JSON.stringify({
            action: "auth",
            token: token,
            username: username
        }));
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.event === "db_changed") {
                if (msg.sender_session === token) {
                    return;
                }
                console.log("Database changed event received from WebSocket. Triggering Delta Sync...");
                this.forceSyncData(true).catch(err => console.error("Real-time sync failed:", err));
            }
        } catch (e) {
            console.error("Error handling WebSocket message:", e);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket connection closed. Reconnecting in 5 seconds...");
        setTimeout(() => this.setupWebSocketConnection(), 5000);
    };

    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        ws.close();
    };
}
