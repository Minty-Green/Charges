import fs from 'node:fs';

const indexPath = 'index.html';
const smokePath = 'scripts/smoke-check.mjs';
let html = fs.readFileSync(indexPath, 'utf8');
let smoke = fs.readFileSync(smokePath, 'utf8');

if (!html.includes('jszip')) {
  const anchor = '<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js"></script>';
  if (!html.includes(anchor)) throw new Error('XLSX script anchor not found');
  html = html.replace(anchor, `${anchor}\n  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>`);
}

if (!html.includes('month-end-control.css')) {
  const anchor = '<link rel="stylesheet" href="finance-reporting.css" />';
  if (!html.includes(anchor)) throw new Error('Finance CSS anchor not found');
  html = html.replace(anchor, `${anchor}\n  <link rel="stylesheet" href="month-end-control.css" />`);
}

if (!html.includes('month-end-control.js')) {
  const anchor = '<script src="finance-reporting.js"></script>';
  if (!html.includes(anchor)) throw new Error('Finance JS anchor not found');
  html = html.replace(anchor, `${anchor}\n<script src="month-end-control.js"></script>`);
}

if (!smoke.includes("const MONTH_END_JS")) {
  smoke = smoke.replace(
    "const FINANCE_JS = new URL('../finance-reporting.js', import.meta.url);",
    "const FINANCE_JS = new URL('../finance-reporting.js', import.meta.url);\nconst MONTH_END_JS = new URL('../month-end-control.js', import.meta.url);"
  );
  smoke = smoke.replace(
    "const financeJs = fs.existsSync(FINANCE_JS) ? fs.readFileSync(FINANCE_JS, 'utf8') : '';",
    "const financeJs = fs.existsSync(FINANCE_JS) ? fs.readFileSync(FINANCE_JS, 'utf8') : '';\nconst monthEndJs = fs.existsSync(MONTH_END_JS) ? fs.readFileSync(MONTH_END_JS, 'utf8') : '';"
  );
  smoke = smoke.replace(
    'const source = `${html}\\n${appJs}\\n${financeJs}`;',
    'const source = `${html}\\n${appJs}\\n${financeJs}\\n${monthEndJs}`;'
  );
}

if (!smoke.includes('// --- Month-end finance control ---')) {
  const anchor = '// --- Static HTML integrity ---';
  if (!smoke.includes(anchor)) throw new Error('Static integrity anchor not found');
  const checks = `// --- Month-end finance control ---\nif (monthEndJs.trim()) {\n  includes('Month-End Closing module present', 'Month-End Closing');\n  includes('Month-End Finance Pack present', 'downloadFinancePack');\n  includes('Month-End reconciliation checks present', 'Finance Reconciliation Checks');\n  includes('Month-End uses charge_entries quantity column', 'resident_id,item_id,quantity,unit_price,charge_date');\n  excludes('Month-End does not use obsolete entry.qty', 'entry.qty');\n  includes('Month-End refreshes recurring pricing data', 'loadRecurringPricingData');\n  includes('Month-End role restriction present', \"currentUserRole === 'admin' || currentUserRole === 'super_admin'\");\n  includes('Month-End JSZip dependency present', 'jszip.min.js');\n  includes('Month-End resident finance PDFs present', 'renderFinancePdfPage');\n  includes('Month-End OPEN warning present', \"code: 'OPEN'\");\n  includes('Month-End zero-charge warning present', \"code: 'ZERO'\");\n  includes('Month-End recurring RM0 warning present', \"code: 'RECURRING'\");\n  expect('Month-End module is read-only', !/\\.(?:insert|update|delete|upsert)\\s*\\(/.test(monthEndJs), 'Month-End control must not write billing data.');\n  expect('index.html references month-end-control.js', /<script[^>]+src=[\"']month-end-control\\.js[\"'][^>]*><\\/script>/i.test(html));\n  expect('index.html references month-end-control.css', /<link[^>]+href=[\"']month-end-control\\.css[\"'][^>]*>/i.test(html));\n}\n\n${anchor}`;
  smoke = smoke.replace(anchor, checks);
}

if (!smoke.includes("new vm.Script(monthEndJs")) {
  const anchor = "  if (financeJs.trim()) new vm.Script(financeJs, { filename: 'finance-reporting.js' });";
  if (!smoke.includes(anchor)) throw new Error('Finance syntax anchor not found');
  smoke = smoke.replace(anchor, `${anchor}\n  if (monthEndJs.trim()) new vm.Script(monthEndJs, { filename: 'month-end-control.js' });`);
}

fs.writeFileSync(indexPath, html);
fs.writeFileSync(smokePath, smoke);

const finalHtml = fs.readFileSync(indexPath, 'utf8');
const finalSmoke = fs.readFileSync(smokePath, 'utf8');
for (const required of ['jszip.min.js', 'month-end-control.css', 'month-end-control.js']) {
  if (!finalHtml.includes(required)) throw new Error(`Missing index wiring: ${required}`);
}
if (!finalSmoke.includes('Month-End module is read-only')) throw new Error('Month-End smoke checks missing');
console.log('Month-end finance control wired successfully');
