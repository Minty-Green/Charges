import fs from 'node:fs';

const appPath = 'app.js';
const smokePath = 'scripts/smoke-check.mjs';
let app = fs.readFileSync(appPath, 'utf8');
let smoke = fs.readFileSync(smokePath, 'utf8');

const replacements = [
  ["function getActiveBranchExportLabel(){\n  return `${getActiveBranchName()} · Mintygreen`;\n}", "function getActiveBranchExportLabel(){\n  return getActiveBranchName();\n}"],
  ["[`MG Bayan Lepas — ${getActiveBranchExportLabel()}`]", "[`Mintygreen Healthcare — ${getActiveBranchExportLabel()}`]"],
  ["doc.text(\n    'MG Bayan Lepas',\n    10,\n    10\n  );", "doc.text(\n    'Mintygreen Healthcare',\n    10,\n    10\n  );"],
  ["`MG Bayan Lepas - Monthly Charges`", "`Mintygreen Healthcare - Monthly Charges`"],
  ["doc.text(\n    'MG Bayan Lepas',\n    14,\n    15\n  );", "doc.text(\n    'Mintygreen Healthcare',\n    14,\n    15\n  );"],
  ["'MG Bayan Lepas - Monthly Charges Summary'", "'Mintygreen Healthcare - Monthly Charges Summary'"],
  ["doc.text('MG Bayan Lepas', 10, 10);", "doc.text('Mintygreen Healthcare', 10, 10);"],
  ["doc.text('MG Bayan Lepas', 14, 15);", "doc.text('Mintygreen Healthcare', 14, 15);"],
  ["const footerLabel = mode === 'calendar' ? 'MG Bayan Lepas - Monthly Charges' : 'MG Bayan Lepas - Monthly Charges Summary';", "const footerLabel = mode === 'calendar' ? 'Mintygreen Healthcare - Monthly Charges' : 'Mintygreen Healthcare - Monthly Charges Summary';"]
];

for (const [from, to] of replacements) {
  if (!app.includes(from)) {
    throw new Error(`Expected export-branding source not found: ${from.slice(0, 80)}`);
  }
  app = app.replace(from, to);
}

// Protect the new export identity in future automated checks.
const smokeNeedle = "includes('Branch-aware export label helper present', 'getActiveBranchExportLabel');";
const smokeInsert = `${smokeNeedle}\nincludes('Export company name is Mintygreen Healthcare', 'Mintygreen Healthcare');\nincludes('Export branch label is branch-only', 'return getActiveBranchName();');`;
if (!smoke.includes(smokeNeedle)) throw new Error('Smoke-check insertion point not found');
if (!smoke.includes("Export company name is Mintygreen Healthcare")) {
  smoke = smoke.replace(smokeNeedle, smokeInsert);
}

fs.writeFileSync(appPath, app);
fs.writeFileSync(smokePath, smoke);
console.log('Export branding updated: Mintygreen Healthcare above active branch name.');
