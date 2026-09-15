import fs from 'node:fs';
import crypto from 'node:crypto';

const indexPath = new URL('../index.html', import.meta.url);
const cssPath = new URL('../styles.css', import.meta.url);

const original = fs.readFileSync(indexPath, 'utf8');
const styleMatches = [...original.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];

if (styleMatches.length !== 1) {
  throw new Error(`Expected exactly one <style> block, found ${styleMatches.length}. No files changed.`);
}

const match = styleMatches[0];
const css = match[1].replace(/^\s*\n/, '').replace(/\s*$/, '') + '\n';
if (!css.trim()) throw new Error('The inline stylesheet is empty. No files changed.');

const replacement = '  <link rel="stylesheet" href="styles.css" />';
const updated = original.slice(0, match.index) + replacement + original.slice(match.index + match[0].length);

// Safety checks: this refactor must not alter the app body or any JS.
const originalBody = original.match(/<body\b[^>]*>[\s\S]*<\/body>/i)?.[0] || '';
const updatedBody = updated.match(/<body\b[^>]*>[\s\S]*<\/body>/i)?.[0] || '';
if (!originalBody || originalBody !== updatedBody) {
  throw new Error('Body content changed unexpectedly. No files changed.');
}

const originalScripts = [...original.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(m => m[0]).join('\n');
const updatedScripts = [...updated.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(m => m[0]).join('\n');
if (originalScripts !== updatedScripts) {
  throw new Error('Script content changed unexpectedly. No files changed.');
}

if (!updated.includes('href="styles.css"')) {
  throw new Error('Stylesheet link was not inserted. No files changed.');
}
if (/<style\b/i.test(updated)) {
  throw new Error('An inline <style> block remains after extraction. No files changed.');
}

fs.writeFileSync(cssPath, css, 'utf8');
fs.writeFileSync(indexPath, updated, 'utf8');

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
console.log(`Extracted ${css.length.toLocaleString()} CSS characters to styles.css.`);
console.log(`Body unchanged: ${hash(originalBody) === hash(updatedBody) ? 'yes' : 'no'}`);
console.log(`Scripts unchanged: ${hash(originalScripts) === hash(updatedScripts) ? 'yes' : 'no'}`);
