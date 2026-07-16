import assert from 'node:assert/strict';
import test from 'node:test';

import { applySyncPayload } from '../../frontend/app/syncMergeUtils.js';
import {
    applyDashboardSummaryAfterMutation,
    buildSyncErrorDetailLines,
    collectCommittedMutationKeys,
    detailRecordExists,
    getSyncValidationErrors,
    mutationAffectsDashboard,
    setupWebSocketConnection,
    shouldScheduleBackgroundSyncForStorageEvent,
    shouldReconnectWebSocket
} from '../../frontend/app/BiddingControllerSync.js';
import { cachePaginatedRecords } from '../../frontend/shared/tableDataUtils.js';
import { normalizeDashboardStatusCounts, summarizeSuperAdminOrganizations } from '../../frontend/app/DashboardView.js';
import { formatDateOnly } from '../../frontend/shared/view_helpers.js';

test('cross-tab sync ignores cursor bookkeeping but reacts to pending mutations', () => {
  const scope = { key: 'user-1:org-1' };
  const key = (base) => `bf_workspace:${scope.key}:${base}`;

  assert.equal(shouldScheduleBackgroundSyncForStorageEvent({ key: key('bf_last_sync_version') }, scope), false);
  assert.equal(shouldScheduleBackgroundSyncForStorageEvent({ key: key('bf_last_fetch_time') }, scope), false);
  assert.equal(shouldScheduleBackgroundSyncForStorageEvent({ key: key('bf_mutation_queue') }, scope), true);
  assert.equal(shouldScheduleBackgroundSyncForStorageEvent({ key: 'bf_workspace:other:bf_mutation_queue' }, scope), false);
});

test('super admin KPIs aggregate business organizations from subscription data once', () => {
  const membership = {
    id: 'org-1',
    name: 'HTD',
    scope_type: 'organization',
    status: 'active',
    subscription: { package_id: 'diamond' }
  };
  const summary = summarizeSuperAdminOrganizations([
    { id: 'manager', name: 'Manager', organizations: [{ ...membership, role: 'manager' }] },
    { id: 'employee', name: 'Employee', organizations: [{ ...membership, role: 'employee' }] },
    { id: 'personal', organizations: [{ id: 'personal-1', name: 'Private', scope_type: 'personal', status: 'active' }] }
  ], [{ id: 'diamond', price: 75_000_000 }]);

  assert.equal(summary.organizations.length, 1);
  assert.equal(summary.organizations[0].userCount, 2);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.activationRate, 100);
  assert.equal(summary.packageCounts.diamond, 1);
  assert.equal(summary.revenue, 75_000_000);
});
import {
    convertDMYHMSToYMDHMS,
    formatCurrency,
    formatDate,
    formatDateWithTime,
    formatForDatetimeLocal,
    formatVND,
    parseVND,
    sumVND
} from '../../frontend/shared/formatters.js';
import { resolveBidContractorName, resolveBidJointVentureMembers } from '../../frontend/partners/contractorVersionBinding.js';

function createModel() {
    return {
        state: { chuyengia: [] },
        useServerSidePagination: false,
        dashboardSummary: null,
        suspendMutationTracking(callback) {
            callback();
        },
        persistData() {}
    };
}

test('sync validation errors support the canonical nested error contract', () => {
    const nested = [{ path: 'goithau[0].giaGoiThau', code: 'INVALID_MONEY' }];
    assert.equal(getSyncValidationErrors({ fields: { errors: nested } }), nested);
    assert.deepEqual(getSyncValidationErrors({ fields: {} }), []);
});

test('sync validation errors retain the legacy flat response compatibility', () => {
    const legacy = [{ table: 'goithau', id: 'gt-1', message: 'invalid' }];
    assert.equal(getSyncValidationErrors({ errors: legacy }), legacy);
});

test('sync error details identify the field, record, reason and validation code', () => {
    assert.deepEqual(buildSyncErrorDetailLines([{
        table: 'goithau',
        id: 'gt-1',
        field: 'giaGoiThau',
        message: 'Giá gói thầu không hợp lệ.',
        code: 'INVALID_MONEY'
    }]), [
        '1. Vị trí: giaGoiThau · Bản ghi: goithau/gt-1\n   Nguyên nhân: Giá gói thầu không hợp lệ.\n   Mã lỗi: INVALID_MONEY'
    ]);
});

test('sync snapshot installs the backend package field policy', () => {
    const model = createModel();
    const contract = { packageFieldPolicy: { lockedAfterInvitation: ['giaGoiThau'], statusOrder: ['Chuẩn bị'] } };
    applySyncPayload(model, { domainContract: contract, partial: true }, { since: '1', useVersionDelta: true });
    assert.deepEqual(model.domainContract, contract);
    assert.equal(Object.isFrozen(model.domainContract), true);
});

test('WebSocket heartbeat replies to server ping without reconnecting', () => {
    const originalWindow = globalThis.window;
    const originalWebSocket = globalThis.WebSocket;
    const sockets = [];

    class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;

        constructor(url) {
            this.url = url;
            this.readyState = MockWebSocket.CONNECTING;
            this.sent = [];
            sockets.push(this);
        }

        send(payload) {
            this.sent.push(JSON.parse(payload));
        }

        close() {
            this.readyState = 3;
        }
    }

    try {
        globalThis.window = { location: { protocol: 'http:', host: '127.0.0.1:8000' } };
        globalThis.WebSocket = MockWebSocket;
        const controller = {
            ws: null,
            model: {
                workspaceScope: { organizationId: 'org-a' },
                getWorkspaceToken: () => 'user-a:org-a@1',
                isWorkspaceCurrent: token => token === 'user-a:org-a@1'
            },
            setupWebSocketConnection
        };

        setupWebSocketConnection.call(controller);
        assert.equal(sockets.length, 1);
        const socket = sockets[0];
        socket.readyState = MockWebSocket.OPEN;
        socket.onopen();
        socket.onmessage({ data: JSON.stringify({ type: 'ping' }) });

        assert.deepEqual(socket.sent, [
            { action: 'auth', organizationId: 'org-a' },
            { type: 'pong' }
        ]);
        assert.equal(controller._wsReconnectTimer, undefined);
    } finally {
        globalThis.window = originalWindow;
        globalThis.WebSocket = originalWebSocket;
    }
});

test('WebSocket authentication failures do not start a reconnect loop', () => {
    assert.equal(shouldReconnectWebSocket(4001), false);
    assert.equal(shouldReconnectWebSocket(4003), false);
    assert.equal(shouldReconnectWebSocket(4403), false);
    assert.equal(shouldReconnectWebSocket(1006), true);
});

test('WebSocket reconnects after network loss and schedules delta sync', () => {
    const originalWindow = globalThis.window;
    const originalWebSocket = globalThis.WebSocket;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const sockets = [];
    let reconnectCallback = null;
    let backgroundSyncDelay = null;
    class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        constructor() { this.readyState = 0; sockets.push(this); }
        send() {}
        close() { this.readyState = 3; }
    }
    try {
        globalThis.window = { location: { protocol: 'http:', host: 'localhost' } };
        globalThis.WebSocket = MockWebSocket;
        globalThis.setTimeout = callback => { reconnectCallback = callback; return 1; };
        globalThis.clearTimeout = () => {};
        const controller = {
            model: {
                workspaceScope: { organizationId: 'org-a' },
                getWorkspaceToken: () => 'scope-a',
                isWorkspaceCurrent: token => token === 'scope-a'
            },
            setupWebSocketConnection,
            scheduleBackgroundSync(delay) { backgroundSyncDelay = delay; }
        };
        setupWebSocketConnection.call(controller);
        sockets[0].onclose({ code: 1006, reason: 'offline' });
        assert.equal(typeof reconnectCallback, 'function');
        reconnectCallback();
        assert.equal(sockets.length, 2);
        sockets[1].onmessage({ data: JSON.stringify({ event: 'db_changed' }) });
        assert.equal(backgroundSyncDelay, 300);
    } finally {
        globalThis.window = originalWindow;
        globalThis.WebSocket = originalWebSocket;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('collects tables that must refresh after committed upserts and deletions', () => {
    const keys = collectCommittedMutationKeys({
        chuyengia: [{ id: 'cg-1' }],
        deletions: [{ table: 'nhathau', id: 'nt-1' }]
    });

    assert.deepEqual([...keys].sort(), ['chuyengia', 'nhathau']);
});

test('replaces stale dashboard summary after a package mutation', () => {
    const model = {
        dashboardSummary: { statusCounts: { 'Hủy thầu': 1 } }
    };
    const payload = {
        goithau: [{ id: 'gt-1', trangThai: 'Đã có kết quả' }],
        deletions: []
    };
    const nextSummary = {
        counts: { goithau: 1 },
        statusCounts: { 'Đã có kết quả': 1 },
        recentPackages: [{ id: 'gt-1', trangThai: 'Đã có kết quả' }]
    };

    assert.equal(mutationAffectsDashboard(payload), true);
    assert.equal(applyDashboardSummaryAfterMutation(model, payload, { dashboardSummary: nextSummary }), true);
    assert.equal(model.dashboardSummary, nextSummary);
});

test('invalidates stale dashboard summary when an older server omits the refreshed summary', () => {
    const model = { dashboardSummary: { statusCounts: { 'Hủy thầu': 1 } } };
    const payload = { goithau: [{ id: 'gt-1' }], deletions: [] };

    assert.equal(applyDashboardSummaryAfterMutation(model, payload, {}), true);
    assert.equal(model.dashboardSummary, null);
});

test('formats date-only fields without midnight text', () => {
    assert.equal(formatDateOnly('2023-12-08 00:00:00'), '08/12/2023');
    assert.equal(formatDateOnly('08/11/2022 00:00'), '08/11/2022');
    assert.equal(formatDate('2026-01-05 13:45:00'), '05/01/2026');
    assert.equal(formatDate('2026-02-05'), '05/02/2026');
    assert.equal(formatDate('2026-03-05'), '05/3/2026');
    assert.equal(formatDate('2026-07-20 00:00:00'), '20/7/2026');
});

test('formats actual time fields in 24-hour Vietnamese display format', () => {
    assert.equal(formatDateWithTime('2026-01-05 23:07:00'), '23:07 ngày 05/01/2026');
    assert.equal(formatDateWithTime('2026-02-05T04:09:00'), '04:09 ngày 05/02/2026');
    assert.equal(formatDateWithTime('2026-03-05 14:09:00'), '14:09 ngày 05/3/2026');
    assert.equal(formatDateWithTime('2026-07-20 00:00:00'), '00:00 ngày 20/7/2026');
});

test('keeps date-first Vietnamese format for editable datetime fields', () => {
    assert.equal(formatForDatetimeLocal('2026-07-20 14:09:00'), '20/07/2026 14:09');
    assert.equal(convertDMYHMSToYMDHMS('20/07/2026 14:09'), '2026-07-20 14:09:00');
});

test('formats and parses Vietnamese currency with dot thousand separators', () => {
    assert.equal(formatCurrency(25000000000), '25.000.000.000 ₫');
    assert.equal(formatVND(95000000), '95.000.000');
    assert.equal(parseVND('25.000.000.000'), 25000000000);
    assert.equal(parseVND('9.007.199.254.740.993'), '9007199254740993');
    assert.equal(sumVND(['9007199254740993', '7', null]), '9007199254741000');
    assert.equal(formatCurrency('9007199254740993'), '9.007.199.254.740.993 ₫');
});

test('reference-only records do not prevent full detail loading', () => {
    const model = {
        state: {
            kehoach: [{ id: 'kh-1', maKeHoach: 'KH-1', tenKeHoach: 'Ke hoach' }]
        }
    };

    assert.equal(detailRecordExists(model, 'kehoach', 'kh-1'), false);
    model.state.kehoach[0].tenDuAnDuToan = 'Du an';
    assert.equal(detailRecordExists(model, 'kehoach', 'kh-1'), true);
});

test('reference records with null detail keys do not prevent partner detail loading', () => {
    const model = {
        state: {
            chudautu: [{
                id: 'cdt-1',
                maChuDauTu: 'vn3000166995',
                tenChuDauTu: 'Chủ đầu tư A',
                diaChi: null,
                daiDienCdt: null,
                referenceOnly: true
            }]
        }
    };

    assert.equal(detailRecordExists(model, 'chudautu', 'vn3000166995'), false);
    model.state.chudautu[0] = { ...model.state.chudautu[0], referenceOnly: false };
    assert.equal(detailRecordExists(model, 'chudautu', 'vn3000166995'), true);
});

test('delta sync preserves server pagination mode and the last complete summary', () => {
    const model = createModel();
    const firstSummary = { counts: { chuyengia: 6, hopdong: 3 } };

    applySyncPayload(model, {
        chuyengia: [],
        useServerSidePagination: true,
        paginatedKeys: ['chuyengia'],
        dashboardSummary: firstSummary
    }, { useVersionDelta: false, since: '0' });

    const deltaResult = applySyncPayload(model, {
        chuyengia: [],
        useServerSidePagination: false,
        paginatedKeys: [],
        dashboardSummary: null
    }, { useVersionDelta: true, since: '2026-07-10 10:00:00' });

    assert.equal(model.useServerSidePagination, true);
    assert.equal(model.dashboardSummary, firstSummary);
    assert.equal(deltaResult.changedKeys.has('dashboardSummary'), false);
});

test('delta sync applies a fresh dashboard summary without disabling pagination', () => {
    const model = createModel();
    model.useServerSidePagination = true;
    model.dashboardSummary = { counts: { chuyengia: 6 } };
    const nextSummary = { counts: { chuyengia: 7 } };

    const result = applySyncPayload(model, {
        useServerSidePagination: false,
        dashboardSummary: nextSummary
    }, { useVersionDelta: true, since: '2026-07-10 10:00:00' });

    assert.equal(model.useServerSidePagination, true);
    assert.equal(model.dashboardSummary, nextSummary);
    assert.equal(result.changedKeys.has('dashboardSummary'), true);
});

test('sync persistence is exposed so the caller can commit the sync version afterwards', async () => {
    let transactionCompleted = false;
    const model = createModel();
    model.db = {
        applySyncChanges({ upserts }) {
            assert.equal(upserts.chuyengia[0].id, 'cg-transaction');
            return Promise.resolve().then(() => {
                transactionCompleted = true;
            });
        }
    };
    const result = applySyncPayload(model, {
        chuyengia: [{ id: 'cg-transaction' }],
        partial: true
    }, { useVersionDelta: true, since: '2026-07-10 10:00:00' });
    assert.equal(transactionCompleted, false);
    await result.persistencePromise;
    assert.equal(transactionCompleted, true);
});

test('SQLite manifest removes stale paginated cache records', async () => {
    const model = createModel();
    model.state.chuyengia = [
        { id: 'cg-server', hoTen: 'Có trên SQLite' },
        { id: 'cg-ghost', hoTen: 'Chỉ có trong IndexedDB' }
    ];
    model.getMutationQueue = () => ({ upserts: {} });
    let deletedIds = [];
    model.db = {
        applySyncChanges({ deletions }) {
            deletedIds = deletions.chuyengia || [];
            return Promise.resolve();
        }
    };

    const result = applySyncPayload(model, {
        chuyengia: [],
        useServerSidePagination: true,
        paginatedKeys: ['chuyengia'],
        recordManifest: { chuyengia: ['cg-server'] }
    }, { useVersionDelta: false, since: '0' });

    await result.persistencePromise;
    assert.deepEqual(model.state.chuyengia.map(item => item.id), ['cg-server']);
    assert.deepEqual(deletedIds, ['cg-ghost']);
});

test('SQLite manifest preserves a valid record waiting for sync', async () => {
    const model = createModel();
    model.state.chuyengia = [{ id: 'cg-pending', hoTen: 'Chờ đồng bộ' }];
    model.getMutationQueue = () => ({
        upserts: { chuyengia: { 'cg-pending': model.state.chuyengia[0] } }
    });

    const result = applySyncPayload(model, {
        chuyengia: [],
        useServerSidePagination: true,
        paginatedKeys: ['chuyengia'],
        recordManifest: { chuyengia: [] }
    }, { useVersionDelta: false, since: '0' });

    await result.persistencePromise;
    assert.deepEqual(model.state.chuyengia.map(item => item.id), ['cg-pending']);
});

test('full sync reference data populates dropdown cache on a clean browser', async () => {
    const model = createModel();
    model.state.chudautu = [];
    model.state.nhathau = [];
    model.normalizeRecordKeys = record => ({ ...record, normalized: true });
    let upserts = {};
    model.db = {
        applySyncChanges(changes) {
            upserts = changes.upserts;
            return Promise.resolve();
        }
    };

    const result = applySyncPayload(model, {
        chudautu: [],
        nhathau: [],
        useServerSidePagination: true,
        paginatedKeys: ['chudautu', 'nhathau'],
        recordManifest: {
            chudautu: ['cdt-1'],
            nhathau: ['nt-1']
        },
        referenceData: {
            chudautu: [{ id: 'cdt-1', tenChuDauTu: 'Chủ đầu tư A', maSoThue: '' }],
            nhathau: [{ id: 'nt-1', tenNhaThau: 'Nhà thầu B' }]
        }
    }, { useVersionDelta: false, since: '0' });

    await result.persistencePromise;
    assert.equal(model.state.chudautu[0].tenChuDauTu, 'Chủ đầu tư A');
    assert.equal(model.state.chudautu[0].maSoThue, '');
    assert.equal(model.state.nhathau[0].tenNhaThau, 'Nhà thầu B');
    assert.equal(model.state.chudautu[0].normalized, true);
    assert.equal(model.state.chudautu[0].referenceOnly, true);
    assert.equal(upserts.chudautu[0].id, 'cdt-1');
    assert.equal(upserts.nhathau[0].id, 'nt-1');
});

test('reference data never overwrites a complete partner cached in IndexedDB', async () => {
    const model = createModel();
    model.state.chudautu = [{
        id: 'cdt-1',
        maChuDauTu: 'vn3000166995',
        tenChuDauTu: 'Chủ đầu tư đầy đủ',
        organizationId: 'org-1',
        daiDienCdt: 'Nguyễn Văn A',
        diaChi: 'Hà Nội'
    }];
    let persisted;
    model.db = {
        applySyncChanges(changes) {
            persisted = changes.upserts.chudautu[0];
            return Promise.resolve();
        }
    };

    const result = applySyncPayload(model, {
        useServerSidePagination: true,
        paginatedKeys: ['chudautu'],
        referenceData: {
            chudautu: [{ id: 'cdt-1', maChuDauTu: 'vn3000166995', tenChuDauTu: 'Tên rút gọn', referenceOnly: true }]
        }
    }, { useVersionDelta: false, since: '0' });

    await result.persistencePromise;
    assert.equal(model.state.chudautu[0].tenChuDauTu, 'Chủ đầu tư đầy đủ');
    assert.equal(model.state.chudautu[0].daiDienCdt, 'Nguyễn Văn A');
    assert.equal(model.state.chudautu[0].referenceOnly, false);
    assert.equal(persisted.diaChi, 'Hà Nội');
});

test('package reference data refreshes authoritative workflow status without dropping full fields', async () => {
    const model = createModel();
    model.state.goithau = [{
        id: 'gt-1',
        tenGoiThau: 'Gói thầu đầy đủ',
        trangThai: 'Đang chấm thầu',
        nguonVon: 'Ngân sách nhà nước',
        referenceOnly: false
    }];

    const result = applySyncPayload(model, {
        useServerSidePagination: true,
        paginatedKeys: ['goithau'],
        referenceData: {
            goithau: [{ id: 'gt-1', tenGoiThau: 'Gói thầu đầy đủ', trangThai: 'Đã có kết quả' }]
        }
    }, { useVersionDelta: false, since: '0' });

    await result.persistencePromise;
    assert.equal(model.state.goithau[0].trangThai, 'Đã có kết quả');
    assert.equal(model.state.goithau[0].nguonVon, 'Ngân sách nhà nước');
    assert.equal(model.state.goithau[0].referenceOnly, true);
});

test('paginated expert records are normalized and merged into the model cache', () => {
    const model = createModel();
    model.state.chuyengia = [{ id: 'cg-1', hoTen: 'Chuyên gia cũ' }];
    model.normalizeRecordKeys = record => ({ ...record, normalized: true });

    const page = cachePaginatedRecords(model, 'chuyengia', [
        { id: 'cg-2', hoTen: 'Chuyên gia mới' }
    ]);

    assert.equal(page[0].normalized, true);
    assert.equal(model.state.chuyengia.length, 2);
    assert.equal(model.state.chuyengia[1].id, 'cg-2');
    assert.equal(model.state.chuyengia[1].referenceOnly, false);
});

test('a complete paginated record replaces reference-only dropdown data', () => {
    const model = createModel();
    model.state.chudautu = [{
        id: 'cdt-1',
        tenChuDauTu: 'Chủ đầu tư A',
        maSoThue: '3002293646',
        referenceOnly: true
    }];
    model.normalizeRecordKeys = record => ({ ...record });

    const page = cachePaginatedRecords(model, 'chudautu', [{
        id: 'cdt-1',
        tenChuDauTu: 'Chủ đầu tư A',
        maSoThue: '3002293646',
        daiDienCdt: 'Bùi Ngọc Nhật',
        diaChi: 'Hà Tĩnh',
        soDienThoai: '0985605155'
    }]);

    assert.equal(page[0].daiDienCdt, 'Bùi Ngọc Nhật');
    assert.equal(model.state.chudautu[0].diaChi, 'Hà Tĩnh');
    assert.equal(model.state.chudautu[0].soDienThoai, '0985605155');
    assert.equal(model.state.chudautu[0].referenceOnly, false);
});

test('dashboard keeps all package statuses visible when the summary is empty', () => {
    const emptyCounts = normalizeDashboardStatusCounts({});
    assert.deepEqual(Object.keys(emptyCounts), [
        'Chuẩn bị',
        'Đang mời thầu',
        'Đã mở thầu',
        'Đang chấm thầu',
        'Đã có kết quả',
        'Hủy thầu'
    ]);
    assert.equal(Object.values(emptyCounts).every(count => count === 0), true);

    const populatedCounts = normalizeDashboardStatusCounts({ 'Đang mời thầu': 2, 'Huỷ thầu': 1 });
    assert.equal(populatedCounts['Đang mời thầu'], 2);
    assert.equal(populatedCounts['Hủy thầu'], 1);
});

test('each package keeps the exact contractor version bound by id', () => {
    const model = {
        state: {
            nhathau: [
                { id: 'nt-00', rootId: 'nt-00', phienBan: '00', tenNhaThau: 'Nhà thầu A' },
                { id: 'nt-01', rootId: 'nt-00', phienBan: '01', tenNhaThau: 'Nhà thầu A đổi tên' }
            ]
        }
    };
    const packageOneBid = { nhaThauId: 'nt-00', loaiNhaThau: 'Độc lập', tenNhaThau: 'Tên snapshot cũ' };
    const packageTwoBid = { nhaThauId: 'nt-01', loaiNhaThau: 'Độc lập', tenNhaThau: 'Tên snapshot cũ' };

    assert.equal(resolveBidContractorName(model, packageOneBid), 'Nhà thầu A');
    assert.equal(resolveBidContractorName(model, packageTwoBid), 'Nhà thầu A đổi tên');
});

test('joint venture name stays unchanged while member names follow exact versions', () => {
    const model = {
        state: {
            nhathau: [
                { id: 'member-00', rootId: 'member-00', phienBan: '00', tenNhaThau: 'Thành viên A' },
                { id: 'member-01', rootId: 'member-00', phienBan: '01', tenNhaThau: 'Thành viên A mới' }
            ]
        }
    };
    const bid = {
        loaiNhaThau: 'Liên danh',
        tenNhaThau: 'Liên danh A - B',
        thanhVienLienDanh: [{ thanhVienNhaThauId: 'member-00', tenNhaThau: 'Tên snapshot' }]
    };

    assert.equal(resolveBidContractorName(model, bid), 'Liên danh A - B');
    assert.equal(resolveBidJointVentureMembers(model, bid)[0].tenNhaThau, 'Thành viên A');
});
