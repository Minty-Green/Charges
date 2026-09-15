import fs from 'node:fs';

const indexPath = 'index.html';
let html = fs.readFileSync(indexPath, 'utf8');

if (!html.includes('finance-reporting.css')) {
  const cssAnchor = '<link rel="stylesheet" href="styles.css" />';
  if (!html.includes(cssAnchor)) throw new Error('styles.css anchor not found');
  html = html.replace(cssAnchor, `${cssAnchor}\n  <link rel="stylesheet" href="finance-reporting.css" />`);
}

if (!html.includes('finance-reporting.js')) {
  const jsAnchor = '<script src="app.js"></script>';
  if (!html.includes(jsAnchor)) throw new Error('app.js anchor not found');
  html = html.replace(jsAnchor, `${jsAnchor}\n<script src="finance-reporting.js"></script>`);
}

fs.writeFileSync(indexPath, html);

const finalHtml = fs.readFileSync(indexPath, 'utf8');
if (!finalHtml.includes('finance-reporting.css')) throw new Error('finance-reporting.css was not wired');
if (!finalHtml.includes('finance-reporting.js')) throw new Error('finance-reporting.js was not wired');
console.log('Finance reporting assets wired into index.html');
