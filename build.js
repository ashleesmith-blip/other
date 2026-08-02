/*
 * Builds index.html — a single self-contained page with React and the compiled
 * app inlined, so it runs from a file:// URL or any static host with no network
 * requests at all. School networks block plenty of CDNs; this sidesteps that.
 *
 *   node build.js
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const react = read('node_modules/react/umd/react.production.min.js');
const reactDom = read('node_modules/react-dom/umd/react-dom.production.min.js');
const css = read('src/styles.css');
const jsx = read('src/athletics.jsx');

const { code } = babel.transformSync(jsx, {
  presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
  compact: false,
  babelrc: false,
  configFile: false,
});

// </script> anywhere inside inlined JS would close the tag early.
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="House athletics, records and district team selection for a P-6 school." />
<title>Athletics Manager</title>
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>${safe(react)}</script>
<script>${safe(reactDom)}</script>
<script>
${safe(code)}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html written — ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB, no external requests');
