import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBuffer, detectDocumentFormat, extractAnchors, extractReferences, inferDate, stripHtml } from '../lib/utils.mjs';
import { splitArticlesForTests, textFromLeyChileJsonForTests } from '../lib/bcn.mjs';
import { buildDownloadUrlForTests, extractDynamicConfigForTests, sourceSetsForTests } from '../lib/sii.mjs';
import { libraryStats, shardName } from '../lib/store.mjs';

test('extrae links y contexto de un índice SII', () => {
  const html = `<div><h5>Circular N° 26 del 18 de Junio del 2026</h5><p>Actualiza instrucciones.</p><a href="circu26.pdf">Ver documento</a></div>`;
  const links = extractAnchors(html, 'https://www.sii.cl/normativa_legislacion/circulares/2026/indcir2026.htm');
  assert.equal(links.length, 1);
  assert.match(links[0].context, /Circular N° 26/);
});

test('extrae referencias cruzadas', () => {
  const refs = extractReferences('Modifica Circular N° 12 de 2021 y Oficio N° 901 de 2026. artículo 31 de la Ley sobre Impuesto a la Renta.');
  assert.ok(refs.some((r) => r.type === 'circular' && r.number === 12 && r.year === 2021));
  assert.ok(refs.some((r) => r.type === 'oficio' && r.number === 901 && r.year === 2026));
  assert.ok(refs.some((r) => r.type === 'articulo' && r.law === 'LIR' && r.article === '31'));
});

test('convierte fecha chilena', () => {
  assert.equal(inferDate('Circular N° 26 del 18 de Junio del 2026', 2026), '2026-06-18');
});

test('separa artículos BCN', () => {
  const articles = splitArticlesForTests('TÍTULO I\nArtículo 1° Texto uno.\nArtículo 2° Texto dos.');
  assert.equal(articles.length, 2);
  assert.equal(articles[0].number, '1');
  assert.match(articles[1].body, /Texto dos/);
});

test('extrae texto principal desde respuesta JSON LeyChile', () => {
  const text = textFromLeyChileJsonForTests({ data: { html: '<h2>LEY</h2><p>Artículo 1° Texto legal suficientemente largo para la prueba de extracción.</p>' } });
  assert.match(text, /Artículo 1/);
  assert.match(text, /Texto legal/);
});

test('limpia HTML básico', () => {
  assert.equal(stripHtml('<p>Hola&nbsp;Chile</p><p>IVA</p>'), 'Hola Chile\nIVA');
});

test('decodifica páginas antiguas Windows-1252', () => {
  const bytes = Buffer.from([0x4f, 0x66, 0x69, 0x63, 0x69, 0x6f, 0x20, 0x4e, 0xba, 0x20, 0x31]);
  assert.equal(decodeBuffer(bytes, 'text/html; charset=windows-1252'), 'Oficio Nº 1');
});

test('detecta formatos históricos por URL y content-type', () => {
  assert.equal(detectDocumentFormat({ url: 'https://sii.cl/oficio123.doc', contentType: 'application/octet-stream', buffer: Buffer.from('x') }), 'doc');
  assert.equal(detectDocumentFormat({ url: 'https://sii.cl/oficio123', contentType: 'application/msword', buffer: Buffer.from('x') }), 'doc');
  assert.equal(detectDocumentFormat({ url: 'https://sii.cl/oficio123.docx', contentType: 'application/octet-stream', buffer: Buffer.from('PK') }), 'docx');
  assert.equal(detectDocumentFormat({ url: 'https://sii.cl/circular.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF-') }), 'pdf');
  assert.equal(detectDocumentFormat({ url: 'https://sii.cl/oficio.rtf', contentType: 'application/rtf', buffer: Buffer.from('{\\rtf') }), 'rtf');
});

test('detecta configuración AJAX de Jurisprudencia Administrativa', () => {
  const html = `$.ajax({ url: 'https://www3.sii.cl/getPublicacionesCTByMateria', data: '{"key":"RENTA","year":"2026"}' });`;
  assert.deepEqual(extractDynamicConfigForTests(html), { key: 'RENTA', year: 2026 });
});

test('construye URL oficial de descarga de Oficio', () => {
  const url = buildDownloadUrlForTests({
    pubNumOficio: '2111',
    pubFechaPubli: '19/08/2026',
    extensionArchPublica: 'pdf',
    idBlobArchPublica: 'blob-123',
    mTypeArchPublica: 'application/pdf',
  });
  assert.match(url, /^https:\/\/www4\.sii\.cl\/gabineteAdmInternet\/descargaArchivo\?/);
  assert.match(url, /nombreDocumento=2111-19%2F08%2F2026\.pdf/);
  assert.match(url, /id=blob-123/);
});

test('mantiene las claves oficiales de materias de Jurisprudencia SII', () => {
  const sources = sourceSetsForTests();
  assert.equal(sources.find((s) => s.category === 'Renta')?.apiKey, 'RENTA');
  assert.equal(sources.find((s) => s.category === 'IVA')?.apiKey, 'IVA');
  assert.equal(sources.find((s) => s.category === 'Otras Normas')?.apiKey, 'OTROS');
});

test('particiona SII por año y BCN en shard propio', () => {
  assert.equal(shardName({ source: 'SII', year: 2025 }), '2025.json');
  assert.equal(shardName({ source: 'BCN', year: 2025 }), 'bcn.json');
});

test('calcula contador global de biblioteca', () => {
  const stats = libraryStats([
    { source: 'SII', type: 'oficio', year: 2026 },
    { source: 'SII', type: 'circular', year: 2025 },
    { source: 'BCN', type: 'articulo', year: 2024 },
  ]);
  assert.equal(stats.total_documents, 3);
  assert.equal(stats.by_source.SII, 2);
  assert.equal(stats.by_type.articulo, 1);
  assert.equal(stats.min_year, 2024);
  assert.equal(stats.max_year, 2026);
});
