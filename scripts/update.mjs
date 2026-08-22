import fs from 'node:fs/promises';
import path from 'node:path';
import { crawlBcn } from '../lib/bcn.mjs';
import { crawlSii } from '../lib/sii.mjs';
import { markdownDocument } from '../lib/utils.mjs';
import { loadDocuments, mergeDocuments, writeLibraryData } from '../lib/store.mjs';

const ROOT = process.cwd();

function argNumber(name) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return null;
  const value = Number(arg.split('=')[1]);
  return Number.isInteger(value) ? value : null;
}

const existing = await loadDocuments(ROOT);
// Se recolectan todos los documentos de esta corrida antes de fusionarlos (en vez de fusionar
// uno por uno a medida que llegan) porque mergeDocuments necesita ver el lote completo para saber
// qué source_url son ambiguas (compartidas por varios documentos, como los artículos BCN que citan
// la misma norma) antes de decidir si puede usarlas como respaldo de identidad.
const collected = [];

async function onDocument(doc, body) {
  collected.push(doc);
  const target = path.join(ROOT, doc.content_path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, markdownDocument(doc, body), 'utf8');
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

const { documents, touched } = mergeDocuments(existing, collected);
await writeLibraryData(ROOT, documents, {
  mode,
  years,
  touched_documents: touched.size,
  last_scrape_at: new Date().toISOString(),
});

console.log(`Documentos totales: ${documents.length}`);
console.log(`Documentos revisados/actualizados: ${touched.size}`);
