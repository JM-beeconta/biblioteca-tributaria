import fs from 'node:fs/promises';
import path from 'node:path';
import { crawlBcn } from '../lib/bcn.mjs';
import { markdownDocument } from '../lib/utils.mjs';
import { libraryStats } from '../lib/store.mjs';

const ROOT = process.cwd();

function arg(name, fallback = null) {
  const item = process.argv.find((value) => value.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : fallback;
}

const OUT = path.resolve(ROOT, arg('out', '.bcn-output'));
const docs = new Map();
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

async function onDocument(doc, body) {
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
}

await crawlBcn({ onDocument, includeHistory: true });
const documents = [...docs.values()];
await fs.writeFile(path.join(OUT, 'docs.json'), `${JSON.stringify(documents)}\n`, 'utf8');
await fs.writeFile(path.join(OUT, 'stats.json'), `${JSON.stringify({
  generated_at: new Date().toISOString(),
  ...libraryStats(documents),
}, null, 2)}\n`, 'utf8');
console.log(`BCN exportado: ${documents.length} registros`);
