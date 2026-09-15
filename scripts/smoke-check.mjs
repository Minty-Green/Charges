import fs from 'node:fs';
import vm from 'node:vm';

const INDEX = new URL('../index.html', import.meta.url);
const APP_JS = new URL('../app.js', import.meta.url);
const FINANCE_JS = new URL('../finance-reporting.js', import.meta.url);
const MONTH_END_JS = new URL('../month-end-control.js', import.meta.url);
const html = fs.readFileSync(INDEX, 'utf8');
const appJs = fs.existsSync(APP_JS) ? fs.readFileSync(APP_JS, 'utf8') : '';
const financeJs = fs.existsSync(FINANCE_JS) ? fs.readFileSync(FINANCE_JS, 'utf8') : '';
const monthEndJs = fs.existsSync(MONTH_END_JS) ? fs.readFileSync(MONTH_END_JS, 'utf8') : '';
const source = `${html}\n${appJs}\n${financeJs}\n${monthEndJs}`;

const checks = [];
const pass = (name, detail = '') => checks.push({ name, ok: true, detail });
const fail = (name, detail = '') => checks.push({ name, ok: false, detail });
const expect = (name, condition, detail = '') => condition ? pass(name, detail) : fail(name, detail);
const includes = (name, needle) => expect(name, source.includes(needle), `Expected: ${needle}`);
const excludes = (name, needle) => expect(name, !source.includes(needle), `Must not contain: ${needle}`);

// --- Core app / PWA wiring ---
includes('Supabase client library present', '@supabase/supabase-js@2');
includes('Turnstile library present', 'challenges.cloudflare.com/turnstile');
includes('PWA manifest linked', 'rel="manifest" href="manifest.json"');
includes('Service worker registration present', 'serviceWorker');
includes('Publishable Supabase key is used', 'sb_publishable_');
excludes('No Supabase service-role key exposed in frontend', 'service_role');
excludes('No Supabase secret key exposed in frontend', 'sb_secret_');

// --- Authentication / account safeguards ---
includes('Password login flow present', 'signInWithPassword');
includes('Password recovery flow present', 'resetPasswordForEmail');
includes('Turnstile login flow present', 'turnstile');
includes('Successful login activity logging present', 'SUCCESS');
includes('Failed-login Edge Function call present', 'log-failed-login');
excludes('No public sign-up flow in frontend', '.signUp(');
excludes('No custom same-as-current password restriction', 'different from your current password');

// --- Role / branch controls ---
includes('Role state present', 'currentUserRole');
includes('Super Admin role present', 'super_admin');
includes('Active branch helper present', 'getActiveBranchName');
includes('Branch-aware export label helper present', 'getActiveBranchExportLabel');
includes('Export company name is Mintygreen Healthcare', 'Mintygreen Healthcare');
includes('Export branch label is branch-only', 'return getActiveBranchName();');
includes('Branch switch function present', 'async function switchActiveBranch');
includes('Branch switch clears usage entries', 'entries = [];');
includes('Branch switch clears recurring records', 'recurring = [];');
includes('Branch switch clears recurring overrides', 'recurringOverrides = [];');
includes('Branch switch clears recurring price history', 'recurringPriceHistory = [];');
includes('Branch switch clears daily entries', 'dailyEntries = [];');
includes('Branch switch clears all-items cache', 'allItems = [];');

// --- Billing-cycle / locking safeguards ---
includes('Billing-cycle helper present', 'function getBillingCycle');
includes('Billing dates helper present', 'function getBillingDates');
includes('Resident-level cycle resident_id included', 'resident_id');
includes('Cycle lock UI present', 'Close Billing Cycle');
includes('Cycle unlock UI present', 'Unlock');
includes('Billing-cycle table reference present', "from('billing_cycles')");
includes('Detailed cycle close confirmation present', 'confirmCycleClose');
includes('Cycle close confirmation shows grand total', 'You are closing');
includes('Unlock reason is required', 'A reason is required to unlock the billing cycle');
includes('Billing-cycle history table reference present', "from('billing_cycle_audit_log')");
includes('Closed-cycle history UI present', 'Closed-Cycle History');
expect(
  'Closed-cycle history appears before charge history',
  html.indexOf('id="cycleHistoryTable"') < html.indexOf('id="auditTable"')
);

// --- Recurring charge / double-charge safeguards ---
includes('Recurring read-only helper present', 'function isRecurringReadOnlyItem');
includes('Machine Rental category protected', "'Machine Rental'");
includes('Package category protected', "'Package'");
includes('Service category protected', "'Service'");
includes('Recurring amount helper present', 'getRecurringAmountForMonth');
includes('Recurring overrides present', 'recurringOverrides');
includes('Recurring price history present', 'recurringPriceHistory');
includes('Special Month flow present', 'Special Month');
includes('Recurring stop flow present', 'Stop');

// --- Daily Entry / Master Calendar ---
includes('Daily Entry renderer present', 'loadDailyEntry');
includes('Master Calendar renderer present', 'renderCalendar');
includes('Quantity save flow present', 'saveQty');
includes('Daily quantity controls present', 'daily-stepper');
includes('Daily Entry search present', 'daily-search');
includes('Calendar search/filter present', 'calendarSearch');

// --- Management / audit / backup / export ---
includes('Residents management present', 'renderResidentList');
includes('Items management present', 'loadAllItems');
includes('Staff management present', 'loadStaff');
includes('Audit History present', 'loadAudit');
includes('Backup creation RPC present', 'create_data_backup');
includes('Backup restore RPC present', 'restore_data_backup');
includes('Excel export present', 'XLSX');
includes('PDF export present', 'jsPDF');
includes('Finance Summary module present', 'Finance Summary');
includes('Finance summary reads charge_entries quantity column', "resident_id,quantity,unit_price,charge_date");
excludes('Finance summary does not reference obsolete qty column', 'entry.qty');
includes('Finance summary refreshes recurring pricing data', 'loadRecurringPricingData');
includes('Finance summary Excel export present', 'exportFinanceSummaryExcel');
includes('Finance summary PDF export present', 'exportFinanceSummaryPdf');

// --- Finance reporting ---
if (financeJs.trim()) {
  includes('Finance Summary module present', 'Finance Summary');
  includes('Finance Summary load function present', 'loadFinanceSummary');
  includes('Finance Summary Excel export present', 'exportFinanceSummaryExcel');
  includes('Finance Summary PDF export present', 'exportFinanceSummaryPdf');
  includes('Finance Summary is Admin/Super Admin only', "currentUserRole === 'admin' || currentUserRole === 'super_admin'");
  includes('Finance Summary resident lock status present', 'Cycle Status');
  expect('index.html references finance-reporting.js', /<script[^>]+src=["']finance-reporting\.js["'][^>]*><\/script>/i.test(html));
  expect('index.html references finance-reporting.css', /<link[^>]+href=["']finance-reporting\.css["'][^>]*>/i.test(html));
}

// --- Month-end finance control ---
if (monthEndJs.trim()) {
  includes('Month-End Closing module present', 'Month-End Closing');
  includes('Month-End Finance Pack present', 'downloadFinancePack');
  includes('Month-End reconciliation checks present', 'Finance Reconciliation Checks');
  includes('Month-End uses charge_entries quantity column', 'resident_id,item_id,quantity,unit_price,charge_date');
  excludes('Month-End does not use obsolete entry.qty', 'entry.qty');
  includes('Month-End refreshes recurring pricing data', 'loadRecurringPricingData');
  includes('Month-End role restriction present', "currentUserRole === 'admin' || currentUserRole === 'super_admin'");
  includes('Month-End JSZip dependency present', 'jszip.min.js');
  includes('Month-End resident finance PDFs present', 'renderFinancePdfPage');
  includes('Month-End OPEN warning present', "code: 'OPEN'");
  includes('Month-End zero-charge warning present', "code: 'ZERO'");
  includes('Month-End recurring RM0 warning present', "code: 'RECURRING'");
  expect('Month-End module is read-only', !/\.(?:insert|update|delete|upsert)\s*\(/.test(monthEndJs), 'Month-End control must not write billing data.');
  expect('index.html references month-end-control.js', /<script[^>]+src=["']month-end-control\.js["'][^>]*><\/script>/i.test(html));
  expect('index.html references month-end-control.css', /<link[^>]+href=["']month-end-control\.css["'][^>]*>/i.test(html));
}

// --- Static HTML integrity ---
const staticIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)]
  .map(m => m[1])
  .filter(id => !id.includes('${'));
const duplicateIds = [...new Set(staticIds.filter((id, i) => staticIds.indexOf(id) !== i))];
expect('No duplicate static HTML IDs', duplicateIds.length === 0, duplicateIds.join(', '));

// Element references may legitimately point to markup created at runtime by
// app.js / finance-reporting.js. Build the resolution set from both static HTML
// and literal id attributes inside JavaScript templates.
const allLiteralIds = [...source.matchAll(/\bid=["']([^"']+)["']/g)]
  .map(m => m[1])
  .filter(id => !id.includes('${'));
const idSet = new Set(allLiteralIds);
const dollarRefs = [...source.matchAll(/\$\(["']([A-Za-z0-9_:-]+)["']\)/g)].map(m => m[1]);
const missingDollarRefs = [...new Set(dollarRefs.filter(id => !idSet.has(id)))];
expect('All literal $(id) references resolve', missingDollarRefs.length === 0, missingDollarRefs.join(', '));

// Inline onclick handlers should reference a declared function. The app uses a
// mix of normal declarations and window.someHandler = async ... assignments.
const declaredFunctions = new Set([
  ...[...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
  ...[...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)].map(m => m[1]),
  ...[...source.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1])
]);
const onclickFunctions = [...html.matchAll(/\bonclick=["']\s*([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
const missingOnclick = [...new Set(onclickFunctions.filter(fn => !declaredFunctions.has(fn)))];
expect('Inline onclick functions resolve', missingOnclick.length === 0, missingOnclick.join(', '));

// Parse inline JS and external application JavaScript for syntax only.
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1])
  .filter(s => s.trim());
let syntaxError = '';
try {
  inlineScripts.forEach((js, i) => new vm.Script(js, { filename: `index-inline-${i + 1}.js` }));
  if (appJs.trim()) new vm.Script(appJs, { filename: 'app.js' });
  if (financeJs.trim()) new vm.Script(financeJs, { filename: 'finance-reporting.js' });
  if (monthEndJs.trim()) new vm.Script(monthEndJs, { filename: 'month-end-control.js' });
} catch (err) {
  syntaxError = String(err?.stack || err);
}
expect('Application JavaScript syntax parses', !syntaxError, syntaxError);

if (appJs.trim()) {
  expect('index.html references external app.js', /<script[^>]+src=["']app\.js["'][^>]*><\/script>/i.test(html));
}

// Guard against accidentally returning to the old per-resident-only read-only rule.
const readonlyFn = source.match(/function\s+isRecurringReadOnlyItem\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
expect(
  'Package/Service/Machine Rental remain globally read-only in entry views',
  readonlyFn.includes('Machine Rental') && readonlyFn.includes('Package') && readonlyFn.includes('Service') && readonlyFn.includes('recurringCategory'),
  readonlyFn ? 'Read-only function found but expected protected categories were not all present.' : 'Read-only function not found.'
);

const failed = checks.filter(c => !c.ok);
const passed = checks.length - failed.length;

console.log(`\nMintygreen Charges smoke check: ${passed}/${checks.length} passed\n`);
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.ok ? ` — ${c.detail}` : ''}`);
}

if (failed.length) {
  console.error(`\n${failed.length} smoke check(s) failed.`);
  process.exit(1);
}

console.log('\nAll smoke checks passed.');
