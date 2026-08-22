import fs from 'node:fs/promises';
import path from 'node:path';
import { crawlBcn } from '../lib/bcn.mjs';
import { crawlSii } from '../lib/sii.mjs';
import { markdownDocument } from '../lib/utils.mjs';

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, 'data', 'index.json');
const REL_FILE = path.join(ROOT, 'data', 'relations.json');
const META_FILE = path.join(ROOT, 'data', 'meta.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

const existing = await readJson(DATA_FILE, []);
const byId = new Map(existing.map((doc) => [doc.id, doc]));
const bySourceUrl = new Map(existing.map((doc) => [doc.source_url, doc]));
const touched = new Set();

async function onDocument(doc, body) {
  const oldByUrl = bySourceUrl.get(doc.source_url);
  const old = byId.get(doc.id) ?? oldByUrl;
  if (old && old.id !== doc.id) byId.delete(old.id);

  const merged = {
    ...old,
    ...doc,
    categories: [...new Set([...(old?.categories ?? []), ...(doc.categories ?? [])])],
    first_seen_at: old?.first_seen_at ?? new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    changed_at: old && old.sha256 !== doc.sha256 ? new Date().toISOString() : old?.changed_at ?? null,
  };

  byId.set(merged.id, merged);
  bySourceUrl.set(merged.source_url, merged);
  touched.add(merged.id);

  const target = path.join(ROOT, merged.content_path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, markdownDocument(merged, body), 'utf8');
}

const requestedFull = process.argv.includes('--full');
const firstRun = existing.length < 20;
const full = requestedFull || firstRun;
const now = new Date();
const currentYear = now.getFullYear();
const minYear = 1974;
const years = full
  ? Array.from({ length: currentYear - minYear + 1 }, (_, i) => currentYear - i)
  : [currentYear, currentYear - 1];

console.log(`Modo: ${full ? 'carga histórica' : 'actualización semanal'}`);
await crawlBcn({ onDocument });
await crawlSii({ years, onDocument });

const documents = [...byId.values()].sort((a, b) => {
  const dateA = a.date ?? `${a.year ?? 0}-01-01`;
  const dateB = b.date ?? `${b.year ?? 0}-01-01`;
  return dateB.localeCompare(dateA) || a.title.localeCompare(b.title, 'es');
});

const relations = {};
for (const doc of documents) relations[doc.id] = doc.references ?? [];

await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
await fs.writeFile(DATA_FILE, JSON.stringify(documents, null, 2) + '\n');
await fs.writeFile(REL_FILE, JSON.stringify(relations, null, 2) + '\n');
await fs.writeFile(META_FILE, JSON.stringify({
  generated_at: new Date().toISOString(),
  mode: full ? 'full' : 'weekly',
  total_documents: documents.length,
  touched_documents: touched.size,
  sources: ['SII', 'BCN'],
  canonical_legal_sources: ['LIR', 'LIVS', 'CT'],
}, null, 2) + '\n');

console.log(`Documentos totales: ${documents.length}`);
console.log(`Documentos revisados/actualizados: ${touched.size}`);
