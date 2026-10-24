import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDocuments, mergeDocuments, selectRangeReplacement, writeLibraryData } from '../lib/store.mjs';

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

// --replace: el tramo recargado REEMPLAZA a los documentos SII guardados de esos años, en vez de
// sumarse. Hace falta para limpiar lo que dejó el lector anterior (oficios duplicados .htm/.doc,
// números tomados de un oficio citado, años equivocados). Protecciones:
// - un año/tipo sin documentos nuevos, o con menos del 45% de los que había, se conserva intacto
//   (índice del SII caído o lector roto); los duplicados viejos hacen que lo normal ronde el 50%;
// - lo ya recargado por otro tramo de la misma campaña (--campaign) no se borra: un oficio de
//   diciembre publicado en el índice del año siguiente llega desde el tramo vecino.
const replace = process.argv.includes('--replace');
const campaign = arg('campaign', null);
const fromYear = Number(arg('from'));
const toYear = Number(arg('to'));
if (replace && (!campaign || !Number.isInteger(fromYear) || !Number.isInteger(toYear))) {
  throw new Error('--replace exige --campaign, --from y --to');
}
if (campaign) for (const doc of incoming) doc.backfill_campaign = campaign;

const { base, removed, kept } = replace
  ? selectRangeReplacement(existing, incoming, { from: fromYear, to: toYear, campaign })
  : { base: existing, removed: [], kept: [] };

const { documents: mergedDocuments } = mergeDocuments(base, incoming, { now });

if (removed.length) {
  const livePaths = new Set(mergedDocuments.map((doc) => doc.content_path));
  for (const doc of removed) {
    if (doc.content_path && !livePaths.has(doc.content_path)) {
      await fs.rm(path.join(ROOT, doc.content_path), { force: true });
    }
  }
}
if (replace) {
  console.log(`Reemplazo ${range}: ${removed.length} documentos anteriores retirados`);
  for (const key of kept) console.log(`Reemplazo ${range}: se conserva ${key} (sin datos nuevos suficientes)`);
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
// Una campaña nueva parte su conteo de tramos desde cero (si no, heredaría los 14 de la anterior y
// se marcaría "completed" con el primer tramo).
const sameCampaign = !campaign || status.campaign === campaign;
const completed = [...new Set([...(sameCampaign ? status.completed_ranges ?? [] : []), range])];
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
  ...(campaign ? { campaign } : {}),
  requested_at: sameCampaign ? status.requested_at ?? now : now,
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
