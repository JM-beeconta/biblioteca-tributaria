import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlBcn, CORE_NORMS, textFromLeyChileJsonForTests, versionsFromMetadatosForTests } from '../lib/bcn.mjs';

function fakeResponse({ status = 200, contentType = 'application/json; charset=utf-8', body }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: 'status',
    url: 'https://nuevo.leychile.cl/servicios/Navegar/get_norma_json',
    headers: { get: (name) => (name === 'content-type' ? contentType : null) },
    arrayBuffer: async () => Buffer.from(text, 'utf8'),
  };
}

// El crawler exige >=3000 caracteres y >=10 artículos para aceptar una respuesta como completa
// (esa es justamente la heurística que detecta la cáscara SPA incompleta de LeyChile), así que los
// fixtures de "respuesta válida" necesitan varios artículos con relleno para no chocar con ese piso.
function buildArticle(number, variant = '') {
  const filler = `Texto de relleno ${variant} para superar el umbral mínimo de longitud exigido por el analizador de contenido. `.repeat(3);
  return `<div class="p">Artículo ${number}.- ${filler}</div>`;
}

function validNormaHtml(articleNumbers, variant = '') {
  // Cada llamada usa un "variant" propio: dos artículos con el mismo número pero cuerpos distintos
  // (como el doble articulado real de DL 824) no deben colapsar por deduplicación de texto idéntico.
  return articleNumbers.map((n, index) => ({ t: buildArticle(n, `${variant}${index}`) }));
}

const TEN_ARTICLES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function withFetchMock(handler, run) {
  const original = global.fetch;
  global.fetch = handler;
  return run().finally(() => { global.fetch = original; });
}

test('textFromLeyChileJson concatena todos los fragmentos, no sólo el más largo (regresión)', () => {
  const longArticle = 'Artículo 14.- '.padEnd(4200, 'x');
  const tree = [{ t: 'Artículo 1.- Primero.' }, { t: longArticle }, { t: 'Artículo 2.- Segundo.' }];
  const text = textFromLeyChileJsonForTests(tree);
  assert.match(text, /Artículo 1/);
  assert.match(text, /Artículo 2/);
  assert.match(text, /Artículo 14/);
});

test('versionsFromMetadatos ignora la versión abierta (vigente) y ordena las cerradas', () => {
  const versions = versionsFromMetadatosForTests({
    vigencias: [
      { desde: '2026-01-01', hasta: '' },
      { desde: '2010-05-01', hasta: '2015-12-31' },
      { desde: '1995-01-01', hasta: '2010-04-30' },
      { desde: 'no-una-fecha', hasta: '2020-01-01' },
    ],
  });
  assert.deepEqual(versions, [
    { from: '1995-01-01', to: '2010-04-30' },
    { from: '2010-05-01', to: '2015-12-31' },
  ]);
});

test('crawlBcn indexa la norma vigente y desambigua números de artículo repetidos (doble articulado)', async () => {
  await withFetchMock(async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('idVersion'), '');
    return fakeResponse({
      body: {
        html: validNormaHtml([...TEN_ARTICLES, '1', '1']),
        metadatos: { id_norma: parsed.searchParams.get('idNorma'), vigencias: [] },
      },
    });
  }, async () => {
    const docs = [];
    await crawlBcn({ includeHistory: false, log: () => {}, onDocument: async (doc) => docs.push(doc) });
    const ids = docs.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, 'todos los ids deben ser únicos');
    const lirArt1Ids = ['bcn-lir-art-1', 'bcn-lir-art-1-2', 'bcn-lir-art-1-3'];
    const lirArt1 = docs.filter((d) => lirArt1Ids.includes(d.id));
    assert.equal(lirArt1.length, 3, 'las 3 ocurrencias de "Artículo 1" deben preservarse con ids distintos');
  });
});

test('crawlBcn rechaza una respuesta incompleta (cáscara SPA de LeyChile) sin emitir documentos', async () => {
  await withFetchMock(async () => fakeResponse({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><body>Este proceso demora demasiado, es probable que su conexión esté muy lenta.</body></html>',
  }), async () => {
    const logs = [];
    const docs = [];
    await crawlBcn({ includeHistory: false, log: (m) => logs.push(m), onDocument: async (doc) => docs.push(doc) });
    assert.equal(docs.length, 0);
    assert.ok(logs.some((l) => /no v(a|á)lido|respuesta/i.test(l)));
  });
});

test('crawlBcn rechaza JSON vacío o sin metadatos coincidentes', async () => {
  await withFetchMock(async () => fakeResponse({ body: { html: [], metadatos: null } }), async () => {
    const docs = [];
    await crawlBcn({ includeHistory: false, log: () => {}, onDocument: async (doc) => docs.push(doc) });
    assert.equal(docs.length, 0);
  });
});

test('crawlBcn no se detiene si una norma responde con error HTTP: sigue con las demás', async () => {
  const requested = [];
  await withFetchMock(async (url) => {
    const idNorma = new URL(url).searchParams.get('idNorma');
    requested.push(idNorma);
    if (idNorma === String(CORE_NORMS[0].idNorma)) {
      return fakeResponse({ status: 500, body: 'error interno' });
    }
    return fakeResponse({
      body: { html: validNormaHtml(TEN_ARTICLES), metadatos: { id_norma: idNorma, vigencias: [] } },
    });
  }, async () => {
    const docs = [];
    await crawlBcn({ includeHistory: false, log: () => {}, onDocument: async (doc) => docs.push(doc) });
    assert.ok(requested.includes(String(CORE_NORMS[1].idNorma)));
    assert.ok(docs.some((d) => d.norm_code === 'LIVS' || d.norm_code === 'CT'));
    assert.ok(!docs.some((d) => d.norm_code === CORE_NORMS[0].code));
  });
});

test('crawlBcn con includeHistory trae versiones cerradas y no reconsulta la vigente como histórica', async () => {
  const requestedVersions = [];
  await withFetchMock(async (url) => {
    const parsed = new URL(url);
    const idVersion = parsed.searchParams.get('idVersion');
    requestedVersions.push(idVersion);
    const idNorma = parsed.searchParams.get('idNorma');
    return fakeResponse({
      body: {
        // El texto histórico debe diferir del vigente: si fueran idénticos, el hash de cambio del
        // crawler los trataría como "sin cambios" y saltaría la versión histórica a propósito.
        html: validNormaHtml(TEN_ARTICLES, idVersion || 'vigente'),
        metadatos: {
          id_norma: idNorma,
          vigencias: [
            { desde: '2026-01-01', hasta: '' },
            { desde: '2000-01-01', hasta: '2025-12-31' },
          ],
        },
      },
    });
  }, async () => {
    const docs = [];
    await crawlBcn({ includeHistory: true, log: () => {}, onDocument: async (doc) => docs.push(doc) });
    assert.ok(!requestedVersions.includes('2026-01-01'), 'la versión abierta no debe volver a pedirse como histórica');
    assert.ok(requestedVersions.includes('2000-01-01'));
    const historical = docs.filter((d) => d.historical_version);
    assert.ok(historical.length > 0);
    assert.ok(historical.every((d) => d.type === 'norma'), 'las versiones históricas se guardan a nivel de norma, no explotadas por artículo');
    const versionDoc = historical.find((d) => d.valid_from === '2000-01-01');
    assert.equal(versionDoc.valid_to, '2025-12-31');
  });
});
