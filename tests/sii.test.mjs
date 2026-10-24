import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSii, extractNumberForTests, sourceSetsForTests } from '../lib/sii.mjs';
import { selectRangeReplacement } from '../lib/store.mjs';
import { decodeBuffer, extractAnchors } from '../lib/utils.mjs';

function htmlResponse(url, body, contentType = 'text/html') {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return {
    status: 200,
    ok: true,
    statusText: 'OK',
    url,
    headers: { get: (name) => (name === 'content-type' ? contentType : null) },
    arrayBuffer: async () => buffer,
  };
}

function withFetchMock(handler, run) {
  const original = global.fetch;
  global.fetch = handler;
  return run().finally(() => { global.fetch = original; });
}

const notFound = { status: 404, ok: false, statusText: 'Not Found', url: '', headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) };

test('decodeBuffer lee como Windows-1252 una página sin charset que no es UTF-8 válido', () => {
  const cp1252 = Buffer.from([0x52, 0x65, 0x73, 0x6f, 0x6c, 0x75, 0x63, 0x69, 0xf3, 0x6e]); // "Resolución"
  assert.equal(decodeBuffer(cp1252, 'text/html'), 'Resolución');
  assert.equal(decodeBuffer(Buffer.from('Resolución', 'utf8'), 'text/html'), 'Resolución');
});

test('extractAnchors decodifica comillas y guiones, y no deja colas de entidades cortadas', () => {
  const filler = 'x'.repeat(75);
  const html = `<a href="a.htm">A</a>${filler}&oacute;n de Asistencia <a href="b.htm">B</a> Cartograf&iacute;a &ldquo;SII-MAPAS&rdquo; &ndash; texto`;
  const anchors = extractAnchors(html, 'https://www.sii.cl/x/');
  const b = anchors.find((a) => a.url.endsWith('b.htm'));
  assert.ok(!/^[a-z]+;/.test(b.context), `contexto sin cola de entidad: ${b.context.slice(0, 20)}`);
  assert.match(b.after, /“SII-MAPAS” – texto/);
});

test('oficios jaNNNN: el número sale del archivo, no del oficio citado en el índice', () => {
  const text = 'RENTA – OFICIO N° 1638, DE 2010. (Ord. Nº 2404, de 23-12-2010)';
  const url = 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/2010/ja2404.htm';
  assert.equal(extractNumberForTests(text, 'oficio', url), 2404);
});

test('índice anual: agrupa .htm/.doc, toma el número de la cita propia final y descarta navegación', async () => {
  const indexUrl = 'https://www.sii.cl/pagina/jurisprudencia/adminis/1996/ley_renta1996.htm';
  const page = [
    '<a href="../anteriores/anteriores_renta.htm">Años Anteriores</a> LEY DE IMPUESTO A LA RENTA 1996',
    '<a href="renta/dic111.htm">Renta</a> Condiciones para la exención. (Oficio N° 3.521, de 19.12.96).',
    '<a href="renta/dic104.htm">Renta</a> Tratamiento de gastos según el Oficio N° 99, de 1990, citado.',
    '<a href="renta/dic104.doc">Word</a> Resumen. Oficio N° 3.496, de 16.12.96',
    '<a href="renta/ene300.htm">Renta</a> Asesorías de la FDF... Oficio N° 3.788, de 18.12.95',
  ].join('\n');
  await withFetchMock(async (url) => {
    if (String(url) === indexUrl) return htmlResponse(indexUrl, page);
    return notFound;
  }, async () => {
    const shells = await discoverSii({ years: [1996], log: () => {}, categories: ['Renta'] });
    const oficios = shells.filter((s) => s.type === 'oficio');
    const byNumber = Object.fromEntries(oficios.map((s) => [s.number, s]));
    assert.deepEqual(Object.keys(byNumber).map(Number).sort((a, b) => a - b), [3496, 3521, 3788]);
    assert.ok(byNumber[3496].source_url.endsWith('dic104.htm'), 'la ficha .htm es la fuente');
    assert.deepEqual(byNumber[3496].alternate_urls, ['https://www.sii.cl/pagina/jurisprudencia/adminis/1996/renta/dic104.doc']);
    assert.equal(byNumber[3521].date_hint, '1996-12-19');
    assert.equal(byNumber[3788].year, 1995, 'un oficio de diciembre publicado en 1996 conserva su año');
    assert.ok(!oficios.some((s) => /anteriores/.test(s.source_url)));
  });
});

test('circulares hasta 2012 se leen de /documentos/circulares/ siguiendo la redirección por JavaScript', async () => {
  const circulares = sourceSetsForTests().find((s) => s.category === 'Circulares');
  assert.equal(circulares.legacyUrl(1990), 'https://www.sii.cl/documentos/circulares/1990/indcir1990.htm');
  const redirectUrl = 'https://www.sii.cl/documentos/circulares/1990/indcir1990.htm';
  const realUrl = 'https://www.sii.cl/documentos/circulares/1990/indcir90.htm';
  await withFetchMock(async (url) => {
    if (String(url) === redirectUrl) return htmlResponse(redirectUrl, '<script>function r(){window.location.replace("indcir90.htm");}</script>');
    if (String(url) === realUrl) {
      return htmlResponse(realUrl, '<a href="circu10.pdf">Circular N° 10</a> texto <a href="circu10.doc">Word</a> <a href="circu13.pdf">Circular N° 13</a> otro');
    }
    return notFound;
  }, async () => {
    const shells = await discoverSii({ years: [1990], log: () => {}, categories: ['Circulares'] });
    assert.deepEqual(shells.map((s) => s.number).sort((a, b) => a - b), [10, 13], 'circu10.pdf y circu10.doc son un solo documento');
    assert.ok(shells.find((s) => s.number === 10).source_url.endsWith('.pdf'));
  });
});

test('selectRangeReplacement retira lo viejo sólo con datos nuevos suficientes y respeta la campaña', () => {
  const existing = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `old-o-${i}`, source: 'SII', type: 'oficio', year: 2000 })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `old-c-${i}`, source: 'SII', type: 'circular', year: 2000 })),
    { id: 'vecino', source: 'SII', type: 'oficio', year: 2000, backfill_campaign: 'c1' },
    { id: 'fuera', source: 'SII', type: 'oficio', year: 2001 },
    { id: 'bcn', source: 'BCN', type: 'norma', year: 2000 },
  ];
  const incoming = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `new-o-${i}`, source: 'SII', type: 'oficio', year: 2000 })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `new-c-${i}`, source: 'SII', type: 'circular', year: 2000 })),
  ];
  const { base, removed, kept } = selectRangeReplacement(existing, incoming, { from: 2000, to: 2000, campaign: 'c1' });
  assert.equal(removed.length, 10, 'los 10 oficios viejos se reemplazan (5 nuevos ≥ 45% de 11)');
  assert.ok(removed.every((d) => d.type === 'oficio'));
  assert.deepEqual(kept, ['2000|circular'], 'circulares: 2 nuevos de 10 parece índice roto, se conservan');
  assert.ok(base.some((d) => d.id === 'vecino') && base.some((d) => d.id === 'fuera') && base.some((d) => d.id === 'bcn'));
});
