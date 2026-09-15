import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', '.ssr-out', 'we-scene']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      if (fs.existsSync(path.join(dir, entry.name, '.git'))) continue;
      walk(path.join(dir, entry.name));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(path.join(dir, entry.name));
  }
}
for (const r of ['web', 'server', 'scripts']) if (fs.existsSync(r)) walk(r);

const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

const dead = [];
for (const [file, src] of sources) {
  for (const m of src.matchAll(EXPORT_RE)) {
    const name = m[1];
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
    let hits = 0;
    for (const [other, text] of sources) {
      if (other === file) continue;
      hits += (text.match(re) ?? []).length;
    }
    if (hits > 0) continue;
    // referenced nowhere else - is it even used inside its own file?
    const own = (src.match(re) ?? []).length;
    dead.push({ file, name, ownUses: own - 1 });
  }
}

console.log('=== referenced nowhere outside their own file ===');
for (const d of dead.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`  ${d.ownUses === 0 ? '[DEAD]' : '[internal only]'} ${d.file}  ->  ${d.name}`);
}
console.log('');
console.log('DEAD = not used anywhere at all. internal only = exported unnecessarily, but the code is live.');
