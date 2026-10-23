import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlBcn, CORE_NORMS, PINNED_LAWS, futureVersionsFromMetadatosForTests, splitArticlesForTests, textFromLeyChileJsonForTests, versionsFromMetadatosForTests } from '../lib/bcn.mjs';

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

test('versionsFromMetadatos deja fuera las versiones que todavía no rigen, aunque estén cerradas', () => {
  const metadatos = {
    vigencias: [
      { desde: '2029-01-01', hasta: '' },
      { desde: '2027-01-01', hasta: '2028-12-31' },
      { desde: '2026-11-01', hasta: '2026-12-31' },
      { desde: '2026-03-27', hasta: '2026-10-31' },
      { desde: '2025-07-11', hasta: '2026-03-26' },
    ],
  };
  assert.deepEqual(versionsFromMetadatosForTests(metadatos, '2026-10-23'), [
    { from: '2025-07-11', to: '2026-03-26' },
    { from: '2026-03-27', to: '2026-10-31' },
  ]);
  assert.deepEqual(futureVersionsFromMetadatosForTests(metadatos, '2026-10-23'), [
    { from: '2026-11-01', to: '2026-12-31', byEvent: false },
    { from: '2027-01-01', to: '2028-12-31', byEvent: false },
    { from: '2029-01-01', to: null, byEvent: false },
  ]);
});

test('la fecha 2222-02-02 de LeyChile se trata como vigencia diferida por evento, no como fecha real', () => {
  const future = futureVersionsFromMetadatosForTests({
    vigencias: [
      { desde: '2222-02-02', hasta: '' },
      { desde: '2026-03-05', hasta: '2222-02-01' },
    ],
  }, '2026-10-23');
  assert.deepEqual(future, [{ from: '2222-02-02', to: null, byEvent: true }]);
  // La vigente "hasta el evento" no es historia: sigue rigiendo y la cubre la consulta sin idVersion.
  assert.deepEqual(versionsFromMetadatosForTests({ vigencias: [{ desde: '2026-03-05', hasta: '2222-02-01' }] }, '2026-10-23'), []);
});

test('splitArticles reconoce "Art. 1°" sólo en normas marcadas (Ley 16.271)', () => {
  const text = 'Art. 1° Las asignaciones por causa de muerte.\nArt. 2° Para los efectos de esta ley se entiende.\nArtículo 3° Texto de un artículo con encabezado completo.';
  assert.deepEqual(splitArticlesForTests(text, { abbreviated: true }).map((a) => a.number), ['1', '2', '3']);
  assert.deepEqual(splitArticlesForTests(text).map((a) => a.number), ['3']);
});

test('crawlBcn indexa por artículo las versiones con vigencia diferida y omite las idénticas a la vigente', async () => {
  const requestedVersions = [];
  await withFetchMock(async (url) => {
    const parsed = new URL(url);
    const idVersion = parsed.searchParams.get('idVersion');
    requestedVersions.push(idVersion);
    const idNorma = parsed.searchParams.get('idNorma');
    // 2029-01-01 devuelve el mismo texto que la vigente: no debe duplicarse.
    const variant = idVersion === '2026-11-01' ? 'reforma' : 'vigente';
    return fakeResponse({
      body: {
        html: validNormaHtml(TEN_ARTICLES, variant),
        metadatos: {
          id_norma: idNorma,
          vigencia: { inicio_vigencia: '2026-03-27', fin_vigencia: '2026-10-31' },
          vigencias: [
            { desde: '2029-01-01', hasta: '' },
            { desde: '2026-11-01', hasta: '2028-12-31' },
            { desde: '2026-03-27', hasta: '2026-10-31' },
          ],
        },
      },
    });
  }, async () => {
    const docs = [];
    const coverage = await crawlBcn({ log: () => {}, now: new Date('2026-10-23T12:00:00'), onDocument: async (doc) => docs.push(doc) });
    assert.ok(requestedVersions.includes('2026-11-01'));
    assert.ok(!requestedVersions.includes('2026-03-27'), 'la vigente no se reconsulta por fecha');
    const futureNorm = docs.find((d) => d.id === 'bcn-lir-v-2026-11-01');
    assert.ok(futureNorm, 'la versión diferida de la LIR debe existir');
    assert.equal(futureNorm.future_version, true);
    assert.equal(futureNorm.valid_from, '2026-11-01');
    assert.equal(futureNorm.valid_to, '2028-12-31');
    assert.ok(docs.some((d) => d.id === 'bcn-lir-v-2026-11-01-art-1' && d.type === 'articulo' && d.future_version));
    assert.ok(!docs.some((d) => d.id === 'bcn-lir-v-2029-01-01'), 'texto idéntico a la vigente no se duplica');
    const current = docs.find((d) => d.id === 'bcn-lir');
    assert.equal(current.valid_from, '2026-03-27');
    assert.equal(current.valid_to, '2026-10-31');
    assert.deepEqual(coverage.base.find((b) => b.code === 'LIR').future_stored, ['2026-11-01']);
  });
});

test('crawlBcn con includeModifiers guarda cada norma modificatoria completa y reporta las que faltan', async () => {
  const LEY = 1229250;
  const FAILING = 999001;
  await withFetchMock(async (url) => {
    const parsed = new URL(url);
    const idNorma = parsed.searchParams.get('idNorma');
    if (parsed.pathname.endsWith('/Vinculaciones/get_vinculaciones')) {
      const aciertos = idNorma === String(CORE_NORMS[0].idNorma)
        ? [
          { IDNORMA: String(LEY), NORMA: 'Ley 21850', FECHA_VIGENCIA: '2026-11-01' },
          { IDNORMA: String(LEY), NORMA: 'Ley 21850', FECHA_VIGENCIA: '2027-01-01' },
          { IDNORMA: String(FAILING), NORMA: 'Decreto 75 EXENTO', FECHA_VIGENCIA: '2025-01-01' },
        ]
        : [{ IDNORMA: String(LEY), NORMA: 'Ley 21850', FECHA_VIGENCIA: '2026-11-01' }];
      return fakeResponse({ body: { cantidadAciertos: aciertos.length, aciertos } });
    }
    if (idNorma === String(FAILING)) return fakeResponse({ status: 500, body: 'error' });
    if (idNorma === String(LEY)) {
      // Una ley corta (un artículo) debe aceptarse: el piso de 10 artículos es sólo para normas base.
      return fakeResponse({
        body: {
          html: [{ t: `<div>Artículo 1.- ${'Modifícase la ley sobre impuesto a la renta en el sentido que indica. '.repeat(6)}</div>` }],
          metadatos: {
            id_norma: idNorma, fecha_publicacion: '2026-10-17', titulo_norma: 'PARA LA RECONSTRUCCIÓN NACIONAL',
            tipos_numeros: [{ descripcion: 'Ley', numero: '21850', compuesto: 'Ley-21850' }],
          },
        },
      });
    }
    return fakeResponse({ body: { html: validNormaHtml(TEN_ARTICLES), metadatos: { id_norma: idNorma, vigencias: [] } } });
  }, async () => {
    const docs = [];
    const coverage = await crawlBcn({ includeModifiers: true, log: () => {}, onDocument: async (doc) => docs.push(doc) });
    const ley = docs.find((d) => d.type === 'norma' && d.norm_code === 'LEY-21850');
    assert.ok(ley, 'la Ley 21.850 debe guardarse como norma propia');
    assert.equal(ley.id, `bcn-ley-21850-${LEY}`);
    assert.equal(ley.norm_kind, 'modificatoria');
    assert.equal(ley.date, '2026-10-17');
    assert.equal(ley.year, 2026);
    assert.deepEqual(ley.categories, ['Leyes modificatorias']);
    assert.ok(ley.modifies.includes('LIR') && ley.modifies.includes('LIVS'));
    assert.deepEqual(ley.effective_dates, ['2026-11-01', '2027-01-01']);
    assert.ok(docs.some((d) => d.type === 'articulo' && d.norm_code === 'LEY-21850'));
    assert.equal(docs.filter((d) => d.type === 'norma' && d.norm_code === 'LEY-21850').length, 1, 'se guarda una vez aunque modifique varias normas');
    assert.deepEqual(coverage.missing.map((m) => m.idNorma), [FAILING]);
    assert.equal(coverage.modifiers_stored, coverage.modifiers_expected - 1);
    assert.equal(coverage.modifiers_expected, 2 + PINNED_LAWS.length - 1);
  });
});

test('splitArticles separa los transitorios escritos con palabras sin partir citas en el texto', () => {
  const text = [
    'Artículo 34.- Texto permanente que modifica el artículo primero del decreto ley N° 824.',
    'Disposiciones Transitorias',
    'Artículo primero transitorio.- Las donaciones que se encuentren afectas al impuesto.',
    'Artículo décimo tercero transitorio.- Facúltase a la Tesorería General de la República.',
    'Artículo único.- Texto de una ley de artículo único con largo suficiente.',
  ].join('\n');
  assert.deepEqual(splitArticlesForTests(text).map((a) => a.number), ['34', 'primero transitorio', 'décimo tercero transitorio', 'único']);
});
