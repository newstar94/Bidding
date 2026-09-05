import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

test('joint venture confirmation updates the opening draft without waiting for risk lookup', async () => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css"><select id="mothau-goithau-select"><option value="pkg">Package</option></select><table><tbody><tr id="opening-row"><td><input class="mt-ma-nha-thau" value="0100000001"><span class="mt-jv-btn-text"></span></td></tr></tbody></table>');
        return;
      }
      res.setHeader('Content-Type', extname(pathname) === '.css' ? 'text/css' : 'text/javascript');
      res.end(await readFile(resolve(pathname.slice(1))));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      window.lucide = { createIcons() {} };
      window.toasts = [];
      // Leave lookup unresolved: confirmation of the editor draft must be local.
      window.fetch = () => new Promise(() => {});
      const { setAppController } = await import('/frontend/app/controllerRef.js');
      setAppController({ model: { getLatestNhaThau: () => [] }, view: { showToast: (...args) => window.toasts.push(args) } });
      const { openMoThauJVManager } = await import('/frontend/packages/bidProcessJointVenture.js');
      openMoThauJVManager(document.getElementById('opening-row'));
      document.getElementById('jv-input-lead-name').value = 'Nhà thầu đứng đầu';
      document.querySelector('.jv-input-mst').value = '0100000002';
      document.querySelector('.jv-input-ten').value = 'Thành viên mới';
      document.getElementById('btn-save-mothau-jv').click();
    });
    assert.equal(await page.locator('#modal-mothau-jv-manager').count(), 0);
    const saved = await page.evaluate(() => ({ members: document.getElementById('opening-row')._thanhVienLienDanh, toasts: window.toasts }));
    assert.equal(saved.members[0].tenNhaThau, 'Thành viên mới');
    assert.match(saved.toasts[0][1], /Lưu thông tin mở thầu/);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
