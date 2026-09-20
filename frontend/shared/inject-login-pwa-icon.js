/**
 * Injeta a logo CDS (PNG) como favicon data-URI no login.
 * Assim o Chrome no celular usa a logo mesmo em “Criar atalho”.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const png = fs.readFileSync(path.join(root, 'apps/mobile/icons/icon-192.png'));
const b64 = png.toString('base64');
const dataUri = `data:image/png;base64,${b64}`;
const loginPath = path.join(__dirname, 'login.html');
let html = fs.readFileSync(loginPath, 'utf8');

const block = `    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#000000">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="CDS Sistemas">
    <title>CDS Sistemas</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" type="image/png" sizes="192x192" href="${dataUri}">
    <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta property="og:image" content="/icon-512.png">`;

if (html.includes('rel="manifest" href="/manifest.webmanifest"') && html.includes('data:image/png;base64,')) {
  console.log('login.html já contém a logo no atalho');
  process.exit(0);
}

const replaced = html.replace(
  /<meta charset="UTF-8">[\s\S]*?(?=<link rel="stylesheet")/,
  `${block}\n    `
);

if (replaced === html || !replaced.includes('rel="manifest"')) {
  throw new Error('Falha ao injetar tags PWA no login.html');
}
html = replaced;

fs.writeFileSync(loginPath, html);
console.log('login.html: logo CDS injetada no favicon/atalho');
