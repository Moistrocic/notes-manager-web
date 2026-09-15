import fs from 'node:fs';
const { parsePkg } = await import('./web/src/lib/we-scene/src/pkg/container.js');
const c = parsePkg(new Uint8Array(fs.readFileSync(process.argv[2])));
const e = c.entries.find((x) => x.name === 'scene.json');
const raw = JSON.parse(new TextDecoder().decode(c.buf.subarray(c.dataStart + e.offset, c.dataStart + e.offset + e.size)));
const want = new Set([0, 13, 17, 18, 19, 21, 22, 23, 24, 25]);
for (const [i, l] of raw.objects.entries()) {
  if (!want.has(i)) continue;
  const keep = {};
  for (const k of ['name','image','visible','solid','particle','parent','attachment','size','origin','scale','alignment','parallaxDepth','color','colorBlendMode','alpha','brightness','locktransforms','fullscreen','effects','instance','dependencies']) {
    if (l[k] !== undefined) keep[k] = l[k];
  }
  console.log('=== #' + String(i).padStart(2,'0') + ' ' + l.name);
  console.log(JSON.stringify(keep, null, 1).split('\n').slice(0, 26).map((s) => '   ' + s).join('\n'));
}
