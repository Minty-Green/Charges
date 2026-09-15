import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../finance-reporting.js', import.meta.url), 'utf8');
const functionSource = source.match(
  /function buildFinanceSummaryWorkbook\(rows, month\) \{[\s\S]*?\n  \}\n\n  function exportFinanceSummaryExcel/
)?.[0]?.replace(/\n\n  function exportFinanceSummaryExcel$/, '');

assert.ok(functionSource, 'buildFinanceSummaryWorkbook must be present');

let capturedData;
let capturedSheet;
let capturedWriteOptions;

const encodeCell = ({ r, c }) => {
  let column = '';
  for (let value = c + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
  }
  return `${column}${r + 1}`;
};

const XLSX = {
  utils: {
    aoa_to_sheet(data) {
      capturedData = data;
      capturedSheet = {};
      data.forEach((row, r) => row.forEach((value, c) => {
        capturedSheet[encodeCell({ r, c })] = { v: value };
      }));
      return capturedSheet;
    },
    encode_cell: encodeCell,
    book_new: () => ({ sheets: [] }),
    book_append_sheet(workbook, sheet, name) {
      workbook.sheets.push({ sheet, name });
    }
  },
  write(workbook, options) {
    capturedWriteOptions = options;
    return { workbook };
  }
};

const context = vm.createContext({
  XLSX,
  branchName: () => 'T',
  periodLabel: () => '25 Aug 2026 - 24 Sept 2026'
});
vm.runInContext(functionSource, context);

context.buildFinanceSummaryWorkbook([
  { name: 'a', room: '1', usageTotal: 351.90, recurringTotal: 0, total: 351.90, locked: true },
  { name: 'b', room: '2', usageTotal: 22, recurringTotal: 48.39, total: 22, locked: false }
], '2026-09');

assert.deepEqual(Array.from(capturedData[9].slice(0, 5)), ['b', '2', 22, 48.39, 70.39]);
assert.deepEqual(Array.from(capturedData.at(-1).slice(0, 5)), ['TOTAL', '', 373.9, 48.39, 422.28999999999996]);
assert.equal(capturedSheet.D10.z, '"RM" #,##0.00;[Red]-"RM" #,##0.00;-');
assert.equal(capturedSheet.A8.s.fill.fgColor.rgb, '176B5B');
assert.equal(capturedSheet.F10.s.alignment.horizontal, 'center');
assert.equal(capturedWriteOptions.cellStyles, true);

console.log('Finance Summary Excel regression check: 6/6 passed');
