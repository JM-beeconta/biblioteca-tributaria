import { loadDocuments } from '../lib/store.mjs';

const ROOT = process.cwd();
const docs = await loadDocuments(ROOT);

const bySource = {};
const seenIds = new Map();
const duplicateIds = [];
const seenUrlHash = new Map();
const duplicateUrlHash = [];
const emptyFields = [];
const tiny = [];

for (const doc of docs) {
  bySource[doc.source] = (bySource[doc.source] || 0) + 1;

  if (seenIds.has(doc.id)) duplicateIds.push(doc.id);
  else seenIds.set(doc.id, true);

  const urlKey = `${doc.source_url}::${doc.sha256}`;
  if (doc.source_url) {
    if (seenUrlHash.has(urlKey)) duplicateUrlHash.push(doc.id);
    else seenUrlHash.set(urlKey, true);
  }

  const missing = [];
  if (!doc.title) missing.push('title');
  if (!doc.date && !doc.year) missing.push('date/year');
  if (!doc.source_url) missing.push('source_url');
  if (!doc.id) missing.push('id');
  if (missing.length) emptyFields.push({ id: doc.id, missing });

  const bodyLen = (doc.search_text || '').length;
  if (bodyLen > 0 && bodyLen < 80) tiny.push({ id: doc.id, length: bodyLen });
}

console.log('=== Conteo por fuente ===');
console.log(JSON.stringify(bySource, null, 2));
console.log('Total:', docs.length);

console.log('\n=== Duplicados por id ===');
console.log('duplicados detectados:', duplicateIds.length);
if (duplicateIds.length) console.log(duplicateIds.slice(0, 20));

console.log('\n=== Duplicados por (source_url + sha256) ===');
console.log('duplicados detectados:', duplicateUrlHash.length);
if (duplicateUrlHash.length) console.log(duplicateUrlHash.slice(0, 20));

console.log('\n=== Campos vacíos ===');
console.log('documentos con campos faltantes:', emptyFields.length);
if (emptyFields.length) console.log(emptyFields.slice(0, 20));

console.log('\n=== Documentos sospechosamente pequeños (search_text < 80 chars) ===');
console.log('total:', tiny.length);
if (tiny.length) console.log(tiny.slice(0, 20));

const bcnDocs = docs.filter((d) => d.source === 'BCN');
console.log('\n=== Muestra BCN (para inspección manual) ===');
const sampleIds = ['bcn-lir', 'bcn-livs', 'bcn-ct'];
for (const id of sampleIds) {
  const doc = bcnDocs.find((d) => d.id === id);
  if (doc) console.log(id, '->', JSON.stringify({ title: doc.title, sha256: doc.sha256, search_text_len: (doc.search_text || '').length }));
}
const oldestHistorical = bcnDocs.filter((d) => d.historical_version).sort((a, b) => (a.valid_from || '').localeCompare(b.valid_from || ''))[0];
const newestHistorical = bcnDocs.filter((d) => d.historical_version).sort((a, b) => (b.valid_from || '').localeCompare(a.valid_from || ''))[0];
console.log('Versión histórica más antigua:', oldestHistorical ? `${oldestHistorical.id} (${oldestHistorical.valid_from} - ${oldestHistorical.valid_to})` : 'ninguna');
console.log('Versión histórica más reciente:', newestHistorical ? `${newestHistorical.id} (${newestHistorical.valid_from} - ${newestHistorical.valid_to})` : 'ninguna');

const failures = [];
if (duplicateIds.length) failures.push(`${duplicateIds.length} ids duplicados`);
if (emptyFields.length) failures.push(`${emptyFields.length} documentos con campos vacíos`);
if (failures.length) {
  console.error('\nFALLÓ la validación de integridad:', failures.join('; '));
  process.exit(1);
}
console.log('\nValidación de integridad OK.');
