import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['web/src', 'server/src', 'web'];
const SKIP = new Set(['node_modules', '.git', 'dist', '.ssr-out', 'we-scene']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      // the vendored submodule is not ours to audit
      if (fs.existsSync(path.join(dir, entry.name, '.git'))) continue;
      walk(path.join(dir, entry.name));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
}
for (const r of ROOTS) if (fs.existsSync(r)) walk(r);
// the checked build scripts describe themselves too
for (const extra of ['web/render-check.tsx', 'web/store-check.tsx', 'web/outline-check.tsx', 'web/dom-check.tsx']) {
  if (fs.existsSync(extra) && !files.includes(extra)) files.push(extra);
}

const sources = new Map();
for (const f of files) sources.set(f, fs.readFileSync(f, 'utf8'));

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const dead = [];
for (const [file, src] of sources) {
  // entry points are referenced from outside our own source
  if (/^(web\/src\/main\.tsx|server\/src\/index\.ts)$/.test(file)) continue;
  for (const m of src.matchAll(EXPORT_RE)) {
    const name = m[1];
    let used = 0;
    for (const [other, text] of sources) {
      if (other === file) continue;
      const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
      if (re.test(text)) used += 1;
    }
    // scripts and configs outside src may reference them by path
    if (used === 0) dead.push({ file, name });
  }
}

console.log('=== exported but never referenced ===');
if (dead.length === 0) console.log('  (none)');
for (const d of dead) console.log(`  ${d.file}  ->  ${d.name}`);

// files nothing imports
console.log('');
console.log('=== files nothing imports ===');
const orphans = [];
for (const file of files) {
  const base = path.basename(file).replace(/\.(ts|tsx)$/, '');
  if (/^(main|index)$/.test(base)) continue;
  if (/check\.tsx$|worker\.ts$|\.worker$/.test(base)) continue;
  let referenced = false;
  for (const [other, text] of sources) {
    if (other === file) continue;
    if (new RegExp(`['"\`][^'"\`]*/${base}(\\.js)?['"\`]`).test(text) || text.includes(`./${base}`) || text.includes(`/${base}'`)) {
      referenced = true;
      break;
    }
  }
  if (!referenced) orphans.push(file);
}
if (orphans.length === 0) console.log('  (none)');
for (const o of orphans) console.log(`  ${o}`);

// dependencies nothing imports
console.log('');
console.log('=== declared dependencies never imported ===');
for (const pkgPath of ['package.json', 'web/package.json', 'server/package.json']) {
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const all = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  const texts = [...sources.values()].join('\n');
  const unused = all.filter((dep) => {
    const name = dep.startsWith('@') ? dep : dep.split('/')[0];
    return !texts.includes(`'${name}'`) && !texts.includes(`"${name}"`) && !texts.includes(`'${name}/`);
  });
  console.log(`  ${pkgPath}: ${unused.length ? unused.join(', ') : '(none)'}`);
}
console.log('');
console.log(`scanned ${files.length} files`);
