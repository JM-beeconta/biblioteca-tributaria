import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDocuments, mergeDocuments, writeLibraryData } from '../lib/store.mjs';

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
const now = new Date().toISOString();
const { documents: mergedDocuments } = mergeDocuments(existing, incoming, { now });

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
const documents = mergedDocuments;

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
