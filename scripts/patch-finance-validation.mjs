import fs from 'node:fs';

const financePath = 'finance-reporting.js';
const smokePath = 'scripts/smoke-check.mjs';
let finance = fs.readFileSync(financePath, 'utf8');
let smoke = fs.readFileSync(smokePath, 'utf8');

const replacements = [
  [".select('resident_id,qty,unit_price,charge_date')", ".select('resident_id,quantity,unit_price,charge_date')"],
  ["Number(entry.qty || 0) * Number(entry.unit_price || 0)", "Number(entry.quantity || 0) * Number(entry.unit_price || 0)"],
  ["      if (typeof loadRecurring === 'function') await loadRecurring();", "      // Refresh special-month overrides and permanent price history before recurring totals.\n      if (typeof loadRecurringPricingData === 'function') await loadRecurringPricingData();\n      if (typeof loadRecurring === 'function') await loadRecurring();"]
];

for (const [from, to] of replacements) {
  if (!finance.includes(from)) throw new Error(`Finance patch anchor not found: ${from}`);
  finance = finance.replace(from, to);
}

if (!smoke.includes("Finance summary reads charge_entries quantity column")) {
  const anchor = "includes('PDF export present', 'jsPDF');";
  if (!smoke.includes(anchor)) throw new Error('Smoke-check export anchor not found');
  const checks = `${anchor}\nincludes('Finance Summary module present', 'Finance Summary');\nincludes('Finance summary reads charge_entries quantity column', \"resident_id,quantity,unit_price,charge_date\");\nexcludes('Finance summary does not reference obsolete qty column', 'entry.qty');\nincludes('Finance summary refreshes recurring pricing data', 'loadRecurringPricingData');\nincludes('Finance summary Excel export present', 'exportFinanceSummaryExcel');\nincludes('Finance summary PDF export present', 'exportFinanceSummaryPdf');`;
  smoke = smoke.replace(anchor, checks);
}

fs.writeFileSync(financePath, finance);
fs.writeFileSync(smokePath, smoke);

const finalFinance = fs.readFileSync(financePath, 'utf8');
if (!finalFinance.includes(".select('resident_id,quantity,unit_price,charge_date')")) throw new Error('quantity column fix missing');
if (finalFinance.includes('entry.qty')) throw new Error('obsolete entry.qty still present');
if (!finalFinance.includes("if (typeof loadRecurringPricingData === 'function') await loadRecurringPricingData();")) throw new Error('pricing refresh missing');
console.log('Finance validation fixes applied');
