import fs from 'node:fs/promises';
import path from 'node:path';
import { crawlBcn } from '../lib/bcn.mjs';
import { crawlSii } from '../lib/sii.mjs';
import { markdownDocument } from '../lib/utils.mjs';
import { loadDocuments, writeLibraryData } from '../lib/store.mjs';

const ROOT = process.cwd();

function argNumber(name) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return null;
  const value = Number(arg.split('=')[1]);
  return Number.isInteger(value) ? value : null;
}

const existing = await loadDocuments(ROOT);
const byId = new Map(existing.map((doc) => [doc.id, doc]));
const bySourceUrl = new Map(existing.filter((doc) => doc.source_url).map((doc) => [doc.source_url, doc]));
const touched = new Set();

async function onDocument(doc, body) {
  const oldByUrl = bySourceUrl.get(doc.source_url);
  const old = byId.get(doc.id) ?? oldByUrl;
  if (old && old.id !== doc.id) byId.delete(old.id);

  const now = new Date().toISOString();
  const merged = {
    ...old,
    ...doc,
    categories: [...new Set([...(old?.categories ?? []), ...(doc.categories ?? [])])],
    first_seen_at: old?.first_seen_at ?? now,
    last_seen_at: now,
    changed_at: old && old.sha256 !== doc.sha256 ? now : old?.changed_at ?? null,
  };

  byId.set(merged.id, merged);
  if (merged.source_url) bySourceUrl.set(merged.source_url, merged);
  touched.add(merged.id);

  const target = path.join(ROOT, merged.content_path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, markdownDocument(merged, body), 'utf8');
}

const now = new Date();
const currentYear = now.getFullYear();
const minYear = 1974;
const requestedFull = process.argv.includes('--full');
const requestedWeekly = process.argv.includes('--weekly');
const skipBcn = process.argv.includes('--skip-bcn');
const skipSii = process.argv.includes('--skip-sii');
const fromArg = argNumber('from');
const toArg = argNumber('to');

if (skipBcn && skipSii) throw new Error('No se puede omitir BCN y SII al mismo tiempo.');

let years;
let mode;
if (fromArg && toArg) {
  const hi = Math.min(currentYear, Math.max(fromArg, toArg));
  const lo = Math.max(minYear, Math.min(fromArg, toArg));
  years = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  mode = `range:${lo}-${hi}`;
} else if (requestedFull) {
  years = Array.from({ length: currentYear - minYear + 1 }, (_, i) => currentYear - i);
  mode = 'full';
} else {
  years = [currentYear, currentYear - 1];
  mode = requestedWeekly ? 'weekly' : 'weekly';
}

console.log(`Modo: ${mode}`);
if (!skipSii) console.log(`Años SII: ${years.at(-1)}-${years[0]}`);
if (!skipBcn) await crawlBcn({ onDocument });
if (!skipSii) await crawlSii({ years, onDocument });

const documents = [...byId.values()];
await writeLibraryData(ROOT, documents, {
  mode,
  years,
  touched_documents: touched.size,
  last_scrape_at: new Date().toISOString(),
});

console.log(`Documentos totales: ${documents.length}`);
console.log(`Documentos revisados/actualizados: ${touched.size}`);
