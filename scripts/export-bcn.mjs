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
const logs = [];
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

function log(message) {
  const line = String(message);
  logs.push(line);
  console.log(line);
}

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

await crawlBcn({ onDocument, includeHistory: true, log });
const documents = [...docs.values()];
const historical = documents.filter((doc) => doc.historical_version).length;
const article31 = documents.some((doc) => doc.type === 'articulo' && doc.norm_code === 'LIR' && String(doc.article) === '31');
const stats = {
  generated_at: new Date().toISOString(),
  ...libraryStats(documents),
  historical_documents: historical,
  has_lir_article_31: article31,
  logs: logs.slice(-250),
};
await fs.writeFile(path.join(OUT, 'docs.json'), `${JSON.stringify(documents)}\n`, 'utf8');
await fs.writeFile(path.join(OUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
console.log(`BCN exportado: ${documents.length} registros; históricos=${historical}; art31=${article31}`);
