import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVietnamAddress } from './PartnerHelpers.js';

function resetAddressCaches() {
    delete globalThis._vietnamProvinces;
    delete globalThis._vietnamWards;
}

test('parseVietnamAddress splits raw API address into detail, ward and province', async () => {
    resetAddressCaches();
    globalThis.fetch = async (url) => {
        if (url === '/api/address/provinces') {
            return {
                ok: true,
                async json() {
                    return [{ code: '01', name: 'Thành phố Hà Nội' }];
                }
            };
        }
        if (url === '/api/address/wards/01') {
            return {
                ok: true,
                async json() {
                    return [{ code: '00001', name: 'Phường Bạch Mai' }];
                }
            };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const parsed = await parseVietnamAddress('Số 1 phố Huế, Phường Bạch Mai, Thành phố Hà Nội');

    assert.equal(parsed.detail, 'Số 1 phố Huế');
    assert.equal(parsed.wardName, 'Phường Bạch Mai');
    assert.equal(parsed.provinceName, 'Thành phố Hà Nội');
    assert.equal(parsed.formattedAddress, 'Số 1 phố Huế | Phường Bạch Mai | Thành phố Hà Nội');
});

test('parseVietnamAddress keeps raw address as detail when no province is matched', async () => {
    resetAddressCaches();
    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return [{ code: '01', name: 'Thành phố Hà Nội' }];
        }
    });

    const raw = 'Unknown long address from API';
    const parsed = await parseVietnamAddress(raw);

    assert.equal(parsed.detail, raw);
    assert.equal(parsed.wardName, '');
    assert.equal(parsed.provinceName, '');
    assert.equal(parsed.formattedAddress, `${raw} |  | `);
});
