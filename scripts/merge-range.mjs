import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDocuments, writeLibraryData } from '../lib/store.mjs';

const ROOT = process.cwd();

function arg(name, fallback = null) {
  const item = process.argv.find((value) => value.startsWith(`--${name}=`));
  return item ? item.slice(name.length + 3) : fallback;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

const input = path.resolve(ROOT, arg('input', '.range-output'));
const range = arg('range', 'desconocido');
const completedTotal = Number(arg('total', '13'));
const incoming = await readJson(path.join(input, 'docs.json'), []);
if (!Array.isArray(incoming)) throw new Error('docs.json inválido');

const existing = await loadDocuments(ROOT);
const byId = new Map(existing.map((doc) => [doc.id, doc]));
const byUrl = new Map(existing.filter((doc) => doc.source_url).map((doc) => [doc.source_url, doc]));
const now = new Date().toISOString();

for (const doc of incoming) {
  const old = byId.get(doc.id) ?? byUrl.get(doc.source_url);
  if (old && old.id !== doc.id) byId.delete(old.id);
  const merged = {
    ...old,
    ...doc,
    categories: [...new Set([...(old?.categories ?? []), ...(doc.categories ?? [])])],
    first_seen_at: old?.first_seen_at ?? doc.first_seen_at ?? now,
    last_seen_at: now,
    changed_at: old && old.sha256 !== doc.sha256 ? now : old?.changed_at ?? doc.changed_at ?? null,
  };
  byId.set(merged.id, merged);
  if (merged.source_url) byUrl.set(merged.source_url, merged);
}

const sourceContent = path.join(input, 'content');
try {
  await fs.cp(sourceContent, path.join(ROOT, 'content'), { recursive: true, force: true });
} catch {}

const statusFile = path.join(ROOT, 'data', 'backfill-status.json');
const status = await readJson(statusFile, {
  status: 'running',
  requested_at: now,
  total_ranges: completedTotal,
  completed_ranges: [],
});
const completed = [...new Set([...(status.completed_ranges ?? []), range])];
const documents = [...byId.values()];

await writeLibraryData(ROOT, documents, {
  mode: `backfill:${range}`,
  last_scrape_at: now,
  touched_documents: incoming.length,
  backfill_status: completed.length >= completedTotal ? 'completed' : 'running',
});

await fs.mkdir(path.dirname(statusFile), { recursive: true });
await fs.writeFile(statusFile, `${JSON.stringify({
  status: completed.length >= completedTotal ? 'completed' : 'running',
  requested_at: status.requested_at ?? now,
  updated_at: now,
  completed_at: completed.length >= completedTotal ? now : null,
  total_ranges: completedTotal,
  completed_ranges: completed,
  completed_count: completed.length,
  last_completed_range: range,
  last_range_documents: incoming.length,
  total_documents: documents.length,
}, null, 2)}\n`, 'utf8');

console.log(`Fusionado ${range}: +${incoming.length} candidatos; biblioteca=${documents.length}`);
console.log(`Progreso: ${completed.length}/${completedTotal}`);
