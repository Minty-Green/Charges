import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../management-analytics.js', import.meta.url), 'utf8');
const functionSource = source.match(
  /function shiftMonth\(month, offset\) \{[\s\S]*?\n  \}\n\n  function ensureUI/
)?.[0]?.replace(/\n\n  function ensureUI$/, '');

assert.ok(functionSource, 'analytics calculation helpers must be present');

const getBillingCycle = month => {
  const [year, value] = month.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, value - 2, 25));
  const endDate = new Date(Date.UTC(year, value - 1, 24));
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10)
  };
};

const context = vm.createContext({
  getBillingCycle,
  getRecurringAmountForMonth: (charge, month) => charge.amounts[month] || 0
});
vm.runInContext(functionSource, context);

assert.deepEqual(Array.from(context.analyticsMonthRange('2026-09', 3)), ['2026-07', '2026-08', '2026-09']);

const result = context.aggregateAnalytics(
  ['2026-08', '2026-09'],
  [{ id: 'r1' }],
  [
    { resident_id: 'r1', item_id: 'i1', quantity: 2, unit_price: 10, charge_date: '2026-07-25' },
    { resident_id: 'r1', item_id: 'i1', quantity: 1, unit_price: 15, charge_date: '2026-08-30' }
  ],
  [{ resident_id: 'r1', item_id: 'i2', amounts: { '2026-08': 40, '2026-09': 50 } }],
  [{ id: 'i1', category: 'Medical Supplies' }, { id: 'i2', category: 'Package' }],
  [{ resident_id: 'r1', billing_month: '2026-08', is_locked: true }]
);

assert.deepEqual(Array.from(result.monthRows, row => row.total), [60, 65]);
assert.deepEqual(Array.from(result.categories, row => [row.name, row.total]), [['Package', 90], ['Medical Supplies', 35]]);
assert.equal(result.residentRows[0].locked, true);
assert.equal(result.residentRows[1].locked, false);
assert.equal(result.residentRows[1].total, 65);

const itemUsage = context.aggregateItemUsage(
  ['2026-08', '2026-09'],
  [{ id: 'r1', name: 'A', room_ref: '1' }, { id: 'r2', name: 'B', room_ref: '2' }],
  [
    { resident_id: 'r1', item_id: 'i1', quantity: 2, unit_price: 10, charge_date: '2026-07-25' },
    { resident_id: 'r1', item_id: 'i1', quantity: 3, unit_price: 10, charge_date: '2026-08-30' },
    { resident_id: 'r1', item_id: 'i2', quantity: 99, unit_price: 1, charge_date: '2026-08-30' }
  ],
  'i1'
);
assert.deepEqual(Array.from(itemUsage.monthlyRows, row => row.quantity), [2, 3]);
assert.equal(itemUsage.residentRows[0].quantity, 5);
assert.equal(itemUsage.residentRows[0].entryDays, 2);
assert.equal(itemUsage.residentRows[0].total, 50);
assert.equal(itemUsage.residentRows[1].quantity, 0);

console.log('Management Analytics regression check: 11/11 passed');
