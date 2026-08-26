/**
 * Production JSX Compiler for STAT2 Trading Terminal
 * Converts public/app.jsx -> public/app.js (Zero in-browser Babel overhead)
 */
const fs = require('fs');
const path = require('path');

async function compile() {
  console.log('⚡ Compiling public/app.jsx -> public/app.js...');
  const res = await fetch('https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js');
  const babelCode = await res.text();
  
  const vm = require('vm');
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  vm.runInContext(babelCode, sandbox);
  const Babel = sandbox.Babel || sandbox.window.Babel;

  const jsxPath = path.join(__dirname, '..', 'public', 'app.jsx');
  const jsPath = path.join(__dirname, '..', 'public', 'app.js');

  const jsxContent = fs.readFileSync(jsxPath, 'utf8');
  const transformed = Babel.transform(jsxContent, {
    presets: [
      ['react', { runtime: 'classic' }]
    ]
  }).code;
  fs.writeFileSync(jsPath, transformed, 'utf8');
  console.log(`✅ Build Complete! Output: ${jsPath} (${transformed.length} bytes)`);

  const liveJsxPath = path.join(__dirname, '..', 'public', 'livestream_app.jsx');
  const liveJsPath = path.join(__dirname, '..', 'public', 'livestream_bundle.js');

  if (fs.existsSync(liveJsxPath)) {
    console.log('⚡ Compiling public/livestream_app.jsx -> public/livestream_bundle.js...');
    const liveContent = fs.readFileSync(liveJsxPath, 'utf8');
    const liveTransformed = Babel.transform(liveContent, {
      presets: [
        ['react', { runtime: 'classic' }]
      ]
    }).code;
    fs.writeFileSync(liveJsPath, liveTransformed, 'utf8');
    console.log(`✅ Livestream Build Complete! Output: ${liveJsPath} (${liveTransformed.length} bytes)`);
  }
}

if (require.main === module) {
  compile().catch(err => {
    console.error('❌ Build failed:', err);
    process.exit(1);
  });
}

module.exports = compile;
