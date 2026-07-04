import assert from 'node:assert/strict';
import test from 'node:test';

import { applySyncPayload } from './syncMergeUtils.js';

function makeModel(state = {}) {
    const persisted = [];
    const putRecordsCalls = [];
    const deleteRecordsCalls = [];

    return {
        state,
        persisted,
        normalizeRecordKeys(record) {
            const normalized = {};
            Object.entries(record).forEach(([key, value]) => {
                const nextKey = key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
                normalized[nextKey] = value;
            });
            return normalized;
        },
        persistData(key) {
            persisted.push(key);
        },
        db: {
            putRecords(key, records) {
                putRecordsCalls.push({ key, records });
                return Promise.resolve();
            },
            deleteRecords(key, ids) {
                deleteRecordsCalls.push({ key, ids });
                return Promise.resolve();
            },
        },
        putRecordsCalls,
        deleteRecordsCalls,
    };
}

test('delta sync merges incoming records by id and normalizes keys', () => {
    const model = makeModel({
        goithau: [
            { id: '1', tenGoiThau: 'Old' },
            { id: '2', tenGoiThau: 'Keep' },
        ],
    });

    const { changedKeys } = applySyncPayload(model, {
        goithau: [
            { id: '1', ten_goi_thau: 'Updated' },
            { id: '3', ten_goi_thau: 'Inserted' },
        ],
        syncVersion: 5,
    }, { useVersionDelta: true, since: '4' });

    assert.deepEqual(model.state.goithau, [
        { id: '1', tenGoiThau: 'Updated' },
        { id: '2', tenGoiThau: 'Keep' },
        { id: '3', tenGoiThau: 'Inserted' },
    ]);
    assert.equal(changedKeys.has('goithau'), true);
    assert.equal(model.putRecordsCalls.length, 1);
});

test('delta sync applies deletions without touching unrelated records', () => {
    const model = makeModel({
        hopdong: [
            { id: 'hd-1', tenHopDong: 'Delete me' },
            { id: 'hd-2', tenHopDong: 'Keep me' },
        ],
    });

    const { changedKeys, deletionsByTable } = applySyncPayload(model, {
        deletions: [{ table: 'hopdong', id: 'hd-1' }],
    }, { useVersionDelta: true, since: '4' });

    assert.deepEqual(model.state.hopdong, [{ id: 'hd-2', tenHopDong: 'Keep me' }]);
    assert.deepEqual(deletionsByTable, { hopdong: ['hd-1'] });
    assert.equal(changedKeys.has('hopdong'), true);
    assert.deepEqual(model.deleteRecordsCalls, [{ key: 'hopdong', ids: ['hd-1'] }]);
});

test('full sync keeps existing paginated cache when server sends empty paginated table', () => {
    const model = makeModel({
        goithau: [{ id: 'gt-local', tenGoiThau: 'Local cache' }],
        chudautu: [{ id: 'cdt-old' }],
    });

    const { changedKeys } = applySyncPayload(model, {
        useServerSidePagination: true,
        paginatedKeys: ['goithau'],
        goithau: [],
        chudautu: [{ id: 'cdt-new' }],
    }, { useVersionDelta: false, since: '0' });

    assert.deepEqual(model.state.goithau, [{ id: 'gt-local', tenGoiThau: 'Local cache' }]);
    assert.deepEqual(model.state.chudautu, [{ id: 'cdt-new' }]);
    assert.equal(changedKeys.has('goithau'), false);
    assert.equal(changedKeys.has('chudautu'), true);
    assert.deepEqual(model.persisted, ['chudautu']);
});
