import fs from 'node:fs';
import vm from 'node:vm';

const INDEX = new URL('../index.html', import.meta.url);
const APP_JS = new URL('../app.js', import.meta.url);
const html = fs.readFileSync(INDEX, 'utf8');
const appJs = fs.existsSync(APP_JS) ? fs.readFileSync(APP_JS, 'utf8') : '';
const source = `${html}\n${appJs}`;

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

// --- Static HTML integrity ---
const staticIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)]
  .map(m => m[1])
  .filter(id => !id.includes('${'));
const duplicateIds = [...new Set(staticIds.filter((id, i) => staticIds.indexOf(id) !== i))];
expect('No duplicate static HTML IDs', duplicateIds.length === 0, duplicateIds.join(', '));

// Element references may legitimately point to markup created at runtime by
// app.js (modal fields, generated quantity inputs, etc.). Build the resolution
// set from both static HTML and literal id attributes inside JS templates.
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

// Parse inline JS and the external app.js (when present) for syntax only.
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1])
  .filter(s => s.trim());
let syntaxError = '';
try {
  inlineScripts.forEach((js, i) => new vm.Script(js, { filename: `index-inline-${i + 1}.js` }));
  if (appJs.trim()) new vm.Script(appJs, { filename: 'app.js' });
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
