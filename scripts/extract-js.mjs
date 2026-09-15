import fs from 'node:fs';

const INDEX = new URL('../index.html', import.meta.url);
const APP = new URL('../app.js', import.meta.url);
const html = fs.readFileSync(INDEX, 'utf8');

const appTag = '<script src="app.js"></script>';
const inlineScriptRegex = /<script(?![^>]*\bsrc=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const matches = [...html.matchAll(inlineScriptRegex)].filter(m => m[1].trim());

if (matches.length === 0) {
  if (html.includes(appTag) && fs.existsSync(APP)) {
    console.log('Application JavaScript is already externalized.');
    process.exit(0);
  }
  throw new Error('No non-empty inline application script found.');
}

if (matches.length !== 1) {
  throw new Error(`Expected exactly one non-empty inline application script, found ${matches.length}. Aborting without changes.`);
}

const match = matches[0];
const fullBlock = match[0];
const js = match[1].trim();

// Safety check: make sure this is the main app script, not a tiny helper block.
const requiredMarkers = [
  'supabase.createClient',
  'loadMonth',
  'renderCalendar',
  'loadDailyEntry',
  'getRecurringAmountForMonth'
];
for (const marker of requiredMarkers) {
  if (!js.includes(marker)) {
    throw new Error(`Inline script does not look like the main app script; missing marker: ${marker}`);
  }
}

const beforeStructure = html.replace(fullBlock, '<!-- APP_SCRIPT_SLOT -->');
const nextHtml = html.replace(fullBlock, appTag);
const afterStructure = nextHtml.replace(appTag, '<!-- APP_SCRIPT_SLOT -->');

if (beforeStructure !== afterStructure) {
  throw new Error('HTML structure changed outside the application script slot. Aborting.');
}

if ((nextHtml.match(/<script[^>]+src=["']app\.js["'][^>]*><\/script>/gi) || []).length !== 1) {
  throw new Error('Expected exactly one app.js script reference after extraction.');
}

fs.writeFileSync(APP, `${js}\n`, 'utf8');
fs.writeFileSync(INDEX, nextHtml, 'utf8');

console.log(`Extracted ${js.length.toLocaleString()} JavaScript characters to app.js.`);
console.log('HTML outside application script slot unchanged: yes');
