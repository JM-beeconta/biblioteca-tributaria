import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBuffer, extractAnchors, extractReferences, inferDate, stripHtml } from '../lib/utils.mjs';
import { splitArticlesForTests } from '../lib/bcn.mjs';

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

test('limpia HTML básico', () => {
  assert.equal(stripHtml('<p>Hola&nbsp;Chile</p><p>IVA</p>'), 'Hola Chile\nIVA');
});

test('decodifica páginas antiguas Windows-1252', () => {
  const bytes = Buffer.from([0x4f, 0x66, 0x69, 0x63, 0x69, 0x6f, 0x20, 0x4e, 0xba, 0x20, 0x31]);
  assert.equal(decodeBuffer(bytes, 'text/html; charset=windows-1252'), 'Oficio Nº 1');
});
