// Bundles src/main.js + three.js and inlines it into a single, self-contained index.html.
// Usage: npm install && node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const font = 'data:font/woff2;base64,' + readFileSync('node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2').toString('base64');
const logo = 'data:image/png;base64,' + readFileSync('src/trinarix-mark.png').toString('base64');
// Photos: src/images/<name>.jpg are embedded as data URIs (keeps index.html a single file).
const img = (name) => 'data:image/jpeg;base64,' + readFileSync(`src/images/${name}.jpg`).toString('base64');
const html = readFileSync('src/template.html', 'utf8')
  .replace(/\/\*IMG:([\w-]+)\*\//g, (_, n) => img(n))
  .replaceAll('/*LOGO*/', () => logo)
  .replaceAll('/*FONT*/', () => font)
  .replace('/*BUNDLE*/', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
