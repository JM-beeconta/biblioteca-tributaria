import fs from 'node:fs/promises';
import path from 'node:path';
import { crawlSii } from '../lib/sii.mjs';
import { markdownDocument } from '../lib/utils.mjs';
import { libraryStats } from '../lib/store.mjs';

const ROOT = process.cwd();

function arg(name, fallback = null) {
  const item = process.argv.find((value) => value.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : fallback;
}

const from = Number(arg('from'));
const to = Number(arg('to'));
const outArg = arg('out', '.range-output');
const categoriesArg = arg('categories', null);
const categories = categoriesArg ? categoriesArg.split(',').map((value) => value.trim()) : null;
if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('Usa --from=AAAA --to=AAAA');

const hi = Math.max(from, to);
const lo = Math.min(from, to);
const years = Array.from({ length: hi - lo + 1 }, (_, index) => hi - index);
const OUT = path.resolve(ROOT, outArg);
const docs = new Map();
const startedAt = new Date().toISOString();

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

// Los originales se archivan en un único release (originales-sii), un .zip por año y tramo: subir
// miles de archivos sueltos choca con el límite de GitHub de ~500 creaciones por hora.
const ORIGINALS_RELEASE = 'originales-sii';

async function onDocument(doc, body, original = null) {
  if (original && doc.original_file) {
    const asset = `sii-${doc.year ?? 'sin-fecha'}-${lo}-${hi}.zip`;
    doc.original_file = { ...doc.original_file, release: ORIGINALS_RELEASE, asset, path: original.name };
  }
  const now = new Date().toISOString();
  const previous = docs.get(doc.id);
  const merged = {
    ...previous,
    ...doc,
    categories: [...new Set([...(previous?.categories ?? []), ...(doc.categories ?? [])])],
    first_seen_at: previous?.first_seen_at ?? now,
    last_seen_at: now,
    changed_at: previous?.changed_at ?? null,
  };
  docs.set(merged.id, merged);

  const target = path.join(OUT, merged.content_path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, markdownDocument(merged, body), 'utf8');

  // Fuera de content/: no entra al repositorio, el workflow lo sube a GitHub Releases.
  if (original && merged.original_file) {
    const originalPath = path.join(OUT, 'originals', merged.original_file.asset.replace(/\.zip$/, ''), original.name);
    await fs.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.writeFile(originalPath, original.buffer);
  }
}

console.log(`Exportando SII ${lo}-${hi}${categories ? ` (${categories.join(', ')})` : ''}`);
await crawlSii({ years, onDocument, categories });

const documents = [...docs.values()];
const extraction = documents.reduce((acc, doc) => {
  const key = doc.extraction_status || 'desconocido';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const formats = documents.reduce((acc, doc) => {
  const key = doc.format || 'desconocido';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(path.join(OUT, 'docs.json'), `${JSON.stringify(documents)}\n`, 'utf8');
await fs.writeFile(path.join(OUT, 'stats.json'), `${JSON.stringify({
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  range: { from: lo, to: hi },
  ...libraryStats(documents),
  extraction,
  formats,
}, null, 2)}\n`, 'utf8');

console.log(`Tramo ${lo}-${hi}: ${documents.length} documentos`);
console.log(`Extracción: ${JSON.stringify(extraction)}`);
console.log(`Formatos: ${JSON.stringify(formats)}`);
