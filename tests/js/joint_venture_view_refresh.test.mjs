import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

test('opening JV click survives repaint but not record removal or workspace change', async () => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      res.setHeader('Content-Type', pathname === '/' ? 'text/html' : 'text/javascript');
      res.end(pathname === '/' ? '<select id="mothau-goithau-select"><option value="pkg">Package</option></select><table><tbody id="mothau-table-tbody"></tbody></table>' : await readFile(resolve(pathname.slice(1))));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results = await page.evaluate(async () => {
      const { addMoThauRow } = await import('/frontend/packages/BidProcessWorkflow.js');
      const results = [];
      for (const mode of ['repaint', 'removed', 'workspace', 'package']) {
        const tbody = document.getElementById('mothau-table-tbody');
        tbody.replaceChildren();
        document.getElementById('mothau-goithau-select').value = 'pkg';
        let current = true;
        const opened = [];
        const owner = {
          model: { state: { nhathau: [] }, getLatestNhaThau: () => [], getWorkspaceToken: () => 'workspace-a', isWorkspaceCurrent: () => current },
          openMoThauJVViewModal: (...args) => opened.push(args),
        };
        const bid = { id: 'bid', loaiNhaThau: 'Liên danh', tenNhaThau: 'Liên danh', maNhaThau: '', violationStatus: 'NO_ACTIVE_VIOLATION', thanhVienLienDanh: [] };
        addMoThauRow.call(owner, 'TU_VAN', { id: 'pkg' }, bid, true);
        const row = tbody.firstElementChild;
        let finish;
        row._violationRefresh = new Promise(resolve => { finish = resolve; });
        row.querySelector('.mt-jv-view-link').click();
        if (mode === 'repaint') {
          tbody.replaceChildren();
          addMoThauRow.call(owner, 'TU_VAN', { id: 'pkg' }, bid, true);
          tbody.firstElementChild._leadMemberName = 'Updated lead';
        } else if (mode === 'removed') row.remove();
        else if (mode === 'workspace') current = false;
        else document.getElementById('mothau-goithau-select').value = '';
        finish();
        await row._violationRefresh;
        await Promise.resolve();
        results.push({ mode, count: opened.length, name: opened[0]?.[1] || '' });
      }
      return results;
    });
    assert.deepEqual(results, [
      { mode: 'repaint', count: 1, name: 'Updated lead' },
      { mode: 'removed', count: 0, name: '' },
      { mode: 'workspace', count: 0, name: '' },
      { mode: 'package', count: 0, name: '' },
    ]);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
