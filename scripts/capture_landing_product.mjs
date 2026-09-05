import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

// Capture the real DashboardView with explicit synthetic demo data, never a user session.
const root = process.cwd();
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      const template = await readFile('views/tabs/tab_dashboard.html', 'utf8');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html lang="vi"><head><title>Product demo fixture</title><meta name="bf-app-debug" content="true"></head><body>${template}</body></html>`);
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(pathname));
    if (!['frontend', 'shared', 'views'].some(folder => file.startsWith(resolve(root, folder) + sep))
      && file !== resolve(root, 'node_modules/dompurify/dist/purify.es.mjs')) throw new Error('Outside asset roots');
    const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const css of ['variables', 'tokens', 'base', 'components', 'ui-redesign']) await page.addStyleTag({ url: `/views/css/${css}.css` });
  await page.evaluate(() => document.querySelector('link[rel="stylesheet"]').setAttribute('data-runtime-styles', ''));
  await page.addStyleTag({ url: '/frontend/app/DashboardView.css' });
  await page.addStyleTag({ content: 'body {height:auto;overflow:auto;padding:24px} #tab-dashboard {display:block} .dashboard-work-grid {grid-template-columns:1fr} .dashboard-priority-card {width:1000px}' });
  await page.addScriptTag({ url: '/views/vendor/lucide/lucide.min.js' });
  await page.evaluate(async () => {
    const { renderDashboard } = await import('/frontend/app/DashboardView.js');
    const summary = {
      counts: {}, statusCounts: {}, recentPackages: [],
      alertItems: [
        { id: 'demo-package', targetType: 'package', maGoiThau: 'MT-2026-018', tenGoiThau: 'Mua sắm thiết bị', alertKey: 'closingToday', deadline: '2026-09-05T14:00:00+07:00' },
        { id: 'demo-contract', targetType: 'contract', soHopDong: 'HD-2026-012', tenHopDong: 'Cung cấp thiết bị', alertKey: 'contractExpiring', deadline: '2026-09-12T17:00:00+07:00' },
        { id: 'demo-plan', targetType: 'plan', maKeHoach: 'KH-2026-006', tenKeHoach: 'Kế hoạch mua sắm', alertKey: 'planPublishingWarning', deadline: '2026-09-06T09:00:00+07:00' },
      ],
    };
    const view = {
      model: { state: { activerole: 'manager', customcontractstatuses: [] }, useServerSidePagination: true, dashboardSummary: summary, getFilteredGoiThau: () => [], formatCurrency: value => `${value} ₫` },
      createIconsScoped: () => window.lucide.createIcons(),
    };
    renderDashboard.call(view);
    await document.fonts.ready;
  });
  await page.locator('.dashboard-priority-card').screenshot({ path: 'views/assets/landing-product-worklist.png' });
  console.log('Captured real DashboardView priority card with synthetic fixture data.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
