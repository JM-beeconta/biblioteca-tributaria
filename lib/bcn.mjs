import { compact, decodeBuffer, extractReferences, fetchResource, sha256, slug, stripHtml } from './utils.mjs';

export const CORE_NORMS = [
  { idNorma: 6368, code: 'LIR', number: 824, title: 'Ley sobre Impuesto a la Renta', category: 'Renta' },
  { idNorma: 6369, code: 'LIVS', number: 825, title: 'Ley sobre Impuesto a las Ventas y Servicios', category: 'IVA' },
  { idNorma: 6374, code: 'CT', number: 830, title: 'Código Tributario', category: 'Código Tributario' },
  { idNorma: 7137, code: 'LTE', number: 3475, title: 'Ley sobre Impuesto de Timbres y Estampillas', category: 'Timbres y Estampillas' },
  { idNorma: 28367, code: 'LIHD', number: 16271, title: 'Ley de Impuesto a las Herencias, Asignaciones y Donaciones', category: 'Herencias y Donaciones', abbreviatedArticles: true },
  { idNorma: 8355, code: 'RIVA', number: 55, title: 'Reglamento de la Ley sobre Impuesto a las Ventas y Servicios', category: 'IVA' },
  // DL 3.063 se consulta por su texto refundido vigente (DS 2.385 de 1996, Interior).
  { idNorma: 18967, code: 'LRM', number: 3063, title: 'Ley de Rentas Municipales', category: 'Rentas Municipales' },
];

// Reformas que deben estar siempre, aunque LeyChile dejara de listarlas como modificatorias de
// alguna norma base: son las que más se consultan por sus artículos transitorios propios.
export const PINNED_LAWS = [
  { idNorma: 1067194, label: 'Ley 20780' },
  { idNorma: 1142667, label: 'Ley 21210' },
  { idNorma: 1172303, label: 'Ley 21420' },
  { idNorma: 1207746, label: 'Ley 21713' },
  { idNorma: 1229250, label: 'Ley 21850' },
];

const MODIFIERS_CATEGORY = 'Leyes modificatorias';

const API_BASE = 'https://nuevo.leychile.cl/servicios';

// La Ley 16.271 (y otras normas antiguas) encabezan sus artículos como "Art. 1°" en vez de
// "Artículo 1°". Se habilita sólo por norma: en las demás, una línea que empieza con "Art." suele
// ser una cita, no el inicio de un artículo.
const NUMBERED = '[0-9]+(?:\\s*(?:bis|ter|quáter|quater|[A-Z]))?(?:[°º])?';
// Las leyes modificatorias numeran sus transitorios con palabras ("Artículo tercero transitorio.-",
// "Artículo único.-"). Sólo cuentan como encabezado si van seguidos del ".-" o "-" de rigor, para no
// partir el texto en una cita como "artículo primero del decreto ley...".
const ORDINAL = '(?:primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|s[eé]ptim[oa]|octav[oa]|noven[oa]|d[eé]cim[oa]|und[eé]cim[oa]|duod[eé]cim[oa]|vig[eé]sim[oa]|trig[eé]sim[oa]|cuadrag[eé]sim[oa]|quincuag[eé]sim[oa]|sexag[eé]sim[oa]|septuag[eé]sim[oa]|octog[eé]sim[oa]|nonag[eé]sim[oa]|cent[eé]sim[oa]|[uú]nic[oa])';
const WORDED = `${ORDINAL}(?:\\s+${ORDINAL}){0,2}(?:\\s+transitori[oa])?(?=\\s*[.°º]?\\s*[-–])`;
const ARTICLE_RE = new RegExp(`(?:^|\\n)\\s*Art(?:í|i)culo\\s+(${NUMBERED}|${WORDED})[.°º-]*\\s*`, 'gim');
const ABBREVIATED_ARTICLE_RE = new RegExp(`(?:^|\\n)\\s*Art(?:(?:í|i)culo\\s+|\\.\\s*)(${NUMBERED}|${WORDED})[.°º-]*\\s*`, 'gim');

function splitArticles(text, { abbreviated = false } = {}) {
  const re = new RegExp(abbreviated ? ABBREVIATED_ARTICLE_RE : ARTICLE_RE);
  const matches = [...text.matchAll(re)];
  const articles = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    if (body.length > 20) articles.push({ number: matches[i][1].trim().replace(/[°º]+$/g, ''), body });
  }
  return articles;
}

function stringsFromJson(value, output = []) {
  if (typeof value === 'string') {
    const text = stripHtml(value).trim();
    if (text.length > 20) output.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsFromJson(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) stringsFromJson(item, output);
  }
  return output;
}

function textFromLeyChileJson(value) {
  // Cada fragmento de texto del árbol de LeyChile (un párrafo o artículo) llega como un nodo
  // independiente: hay que concatenarlos todos en orden de documento, nunca quedarse sólo con
  // el fragmento más largo (un artículo extenso descartaría silenciosamente a todos los demás).
  return [...new Set(stringsFromJson(value))].join('\n\n');
}

function apiUrl(norm, versionDate) {
  const params = new URLSearchParams({
    idNorma: String(norm.idNorma),
    idVersion: versionDate ?? '',
    idLey: '',
    tipoVersion: '',
    cve: '',
    agrupa_partes: '1',
    r: '',
  });
  return `${API_BASE}/Navegar/get_norma_json?${params}`;
}

function navegarUrl(norm, versionDate = null) {
  const params = new URLSearchParams({ idNorma: String(norm.idNorma) });
  if (versionDate) { params.set('idVersion', versionDate); params.set('tipoVersion', ''); }
  return `https://www.bcn.cl/leychile/navegar?${params}`;
}

// LeyChile sirve el texto real vía esta API JSON interna (descubierta inspeccionando el bundle Angular público);
// las rutas /leychile/Navegar/imprimir y /leychile/navegar sólo entregan la cáscara de la SPA sin ejecutar JS.
// Una ley modificatoria o un decreto exento pueden tener uno o dos artículos: el piso de 3000
// caracteres / 10 artículos de las normas base los descartaría. Para ellas basta con descartar
// la cáscara vacía de LeyChile.
const BASE_MIN = { chars: 3000, articles: 10 };
const MODIFIER_MIN = { chars: 200, articles: 0 };

async function fetchNormaApi(norm, versionDate = null, log = console.log, min = BASE_MIN) {
  const url = apiUrl(norm, versionDate);
  let response;
  try {
    response = await fetchResource(url, {
      retries: 3,
      delayMs: 400,
      timeoutMs: 30000,
      headers: { accept: 'application/json', referer: navegarUrl(norm, versionDate) },
    });
  } catch (error) {
    log(`[BCN] API ${norm.code}${versionDate ? ` ${versionDate}` : ''}: ${error.message}`);
    return null;
  }
  if (!response) return null;

  const raw = decodeBuffer(response.buffer, response.contentType || 'application/json; charset=utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log(`[BCN] API ${norm.code}${versionDate ? ` ${versionDate}` : ''}: respuesta no es JSON válido (${raw.length} caracteres)`);
    return null;
  }

  if (!Array.isArray(parsed.html) || !parsed.html.length) {
    log(`[BCN] API ${norm.code}${versionDate ? ` ${versionDate}` : ''}: respuesta sin contenido estructurado`);
    return null;
  }
  if (!parsed.metadatos || String(parsed.metadatos.id_norma) !== String(norm.idNorma)) {
    log(`[BCN] API ${norm.code}${versionDate ? ` ${versionDate}` : ''}: metadatos ausentes o idNorma no coincide`);
    return null;
  }

  const text = textFromLeyChileJson(parsed.html).trim();
  const articles = splitArticles(text, { abbreviated: norm.abbreviatedArticles });
  if (text.length < min.chars || articles.length < min.articles) {
    log(`[BCN] Contenido incompleto ${norm.code}${versionDate ? ` ${versionDate}` : ''}: ${text.length} caracteres, ${articles.length} artículos`);
    return null;
  }

  return { text, url: response.url, metadatos: parsed.metadatos, format: 'leychile-api' };
}

function todayIso(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// LeyChile fecha en 2222-02-02 las versiones "con vigencia diferida por evento": rigen cuando ocurra
// un hecho (p.ej. un reglamento) cuya fecha no se conoce. No es una fecha real y no debe mostrarse.
const EVENT_SENTINEL_YEAR = 2200;

function isEventSentinel(date) {
  return Boolean(date) && Number(String(date).slice(0, 4)) >= EVENT_SENTINEL_YEAR;
}

function validVigencias(metadatos) {
  const vigencias = Array.isArray(metadatos?.vigencias) ? metadatos.vigencias : [];
  const seen = new Set();
  const output = [];
  for (const v of vigencias) {
    const desde = v?.desde;
    if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || seen.has(desde)) continue;
    seen.add(desde);
    output.push({ from: desde, to: v.hasta && !isEventSentinel(v.hasta) ? v.hasta : null, byEvent: isEventSentinel(desde) });
  }
  return output.sort((a, b) => a.from.localeCompare(b.from));
}

// Versiones históricas = cerradas y ya empezadas. Las que todavía no rigen (vigencia diferida) no
// son historia: se tratan aparte en futureVersionsFromMetadatos, con su propio desglose por artículo.
function versionsFromMetadatos(metadatos, today = todayIso()) {
  return validVigencias(metadatos).filter((v) => v.to && v.from <= today).map(({ from, to }) => ({ from, to }));
}

// Versiones con vigencia diferida: LeyChile ya publica el texto que regirá desde una fecha futura
// (p.ej. la LIR con la rebaja de Primera Categoría de la Ley 21.850 desde 2026-11-01). La consulta
// sin idVersion sólo entrega la versión que rige hoy, así que sin esto la reforma no existe en la
// base hasta el día en que entra a regir.
function futureVersionsFromMetadatos(metadatos, today = todayIso()) {
  return validVigencias(metadatos).filter((v) => v.from > today);
}

function vinculacionesUrl(idNorma, page, perPage) {
  const params = new URLSearchParams({
    idNorma: String(idNorma),
    clase_vinculacion: 'modificacion',
    sentido: 'modifica_por',
    npagina: String(page),
    itemsporpagina: String(perPage),
  });
  return `${API_BASE}/Vinculaciones/get_vinculaciones?${params}`;
}

// Normas que modificaron a una norma base, según el registro de vinculaciones de LeyChile (el mismo
// que muestra la pestaña "Modificaciones" de cada norma). Cada fila es una parte modificada; se
// agrupan por norma modificatoria.
async function listModifyingNorms(norm, log = console.log) {
  const perPage = 200;
  const found = new Map();
  const unavailable = new Set();
  let total = 0;
  for (let page = 1; page <= 50; page++) {
    let parsed;
    try {
      const response = await fetchResource(vinculacionesUrl(norm.idNorma, page, perPage), {
        retries: 3, delayMs: 400, timeoutMs: 60000,
        headers: { accept: 'application/json', referer: navegarUrl(norm) },
      });
      parsed = response ? JSON.parse(decodeBuffer(response.buffer, 'application/json; charset=utf-8')) : null;
    } catch (error) {
      log(`[BCN] Modificaciones ${norm.code} página ${page}: ${error.message}`);
      return null;
    }
    const rows = Array.isArray(parsed?.aciertos) ? parsed.aciertos : null;
    if (!rows) return page === 1 ? null : { modifiers: [...found.values()], unavailable: [...unavailable] };
    total = Number(parsed.cantidadAciertos) || 0;
    for (const row of rows) {
      const id = String(row.IDNORMA ?? '').trim();
      // IDNORMA 0: LeyChile registra la modificación pero no tiene el texto de esa norma.
      if (!/^\d+$/.test(id) || Number(id) === 0) {
        unavailable.add(row.NORMA ?? row.COMPUESTO ?? 'sin identificar');
        continue;
      }
      const entry = found.get(id) ?? { idNorma: Number(id), label: row.NORMA ?? row.COMPUESTO ?? `Norma ${id}`, effective: new Set() };
      if (/^\d{4}-\d{2}-\d{2}$/.test(row.FECHA_VIGENCIA ?? '')) entry.effective.add(row.FECHA_VIGENCIA);
      found.set(id, entry);
    }
    if (!rows.length || page * perPage >= total) break;
  }
  return {
    modifiers: [...found.values()].map((entry) => ({ ...entry, effective: [...entry.effective].sort() })),
    unavailable: [...unavailable],
  };
}

async function emitNorm({ norm, fetched, onDocument, versionDate = null, validTo = null, historical = false, future = false, byEvent = false }) {
  const text = fetched.text.trim();
  const articles = historical ? [] : splitArticles(text, { abbreviated: norm.abbreviatedArticles });

  let versionLabel = 'Versión vigente consultada en LeyChile';
  if (byEvent) versionLabel = 'Versión con vigencia diferida por evento: rige cuando se cumpla el hecho o condición que fija la ley (sin fecha conocida)';
  else if (versionDate) versionLabel = `${future ? 'Versión con vigencia diferida: rige' : 'Versión'} desde ${versionDate}${validTo ? ` hasta ${validTo}` : ''}`;
  const suffix = versionDate ? `-v-${versionDate}` : '';
  const baseSlug = norm.slug ?? norm.code.toLowerCase();
  const normId = `bcn-${baseSlug}${suffix}`;
  // Sin idVersion, LeyChile informa en metadatos.vigencia el tramo de la versión que entrega.
  const currentFrom = versionDate ? null : fetched.metadatos?.vigencia?.inicio_vigencia || null;
  const rawCurrentTo = versionDate ? null : fetched.metadatos?.vigencia?.fin_vigencia || null;
  const currentTo = isEventSentinel(rawCurrentTo) ? null : rawCurrentTo;
  const validFrom = byEvent ? null : versionDate ?? currentFrom;
  const validUntil = versionDate ? validTo : currentTo;
  const extra = norm.extra ?? {};
  // La fecha centinela de una versión "por evento" no es una fecha: no se muestra ni se usa como año.
  const shownDate = byEvent ? null : versionDate;
  const year = byEvent ? null : versionDate
    ? Number(versionDate.slice(0, 4))
    : Number(fetched.metadatos?.fecha_publicacion?.slice(0, 4)) || 1974;
  const sourceUrl = navegarUrl(norm, versionDate);

  await onDocument({
    id: normId, source: 'BCN', type: 'norma', number: norm.number, year, date: shownDate,
    title: `${norm.title}${byEvent ? ' — versión con vigencia diferida por evento' : versionDate ? ` — versión ${versionDate}` : ''}`,
    summary: `Texto legal oficial de LeyChile. ${versionLabel}.`, categories: [norm.category], source_url: sourceUrl,
    sha256: sha256(text), format: fetched.format, references: extractReferences(text),
    search_text: compact(`${norm.title} ${versionLabel} ${text}`, 9000), content_path: `content/bcn/normas/${normId}.md`,
    norm_code: norm.code, idNorma: norm.idNorma, version: versionLabel, version_date: shownDate,
    valid_from: validFrom, valid_to: validUntil, historical_version: historical, future_version: future, deferred_by_event: byEvent, ...extra,
  }, text);

  const articleOccurrences = new Map();
  for (const article of articles) {
    // DL 824 y otras normas usan "doble articulado" (un artículo único del decreto que aprueba el
    // texto de la ley, cuyos propios artículos reinician la numeración) y artículos transitorios que
    // también repiten números 1..N — sin desambiguar, el segundo/tercer "Artículo 1" pisaría al primero.
    const articleSlug = slug(article.number);
    const occurrence = (articleOccurrences.get(articleSlug) ?? 0) + 1;
    articleOccurrences.set(articleSlug, occurrence);
    const articleId = occurrence > 1 ? `${normId}-art-${articleSlug}-${occurrence}` : `${normId}-art-${articleSlug}`;
    await onDocument({
      id: articleId, source: 'BCN', type: 'articulo', number: article.number, year, date: shownDate,
      title: `Artículo ${article.number} — ${norm.title}${versionDate ? ` · versión ${versionDate}` : ''}`,
      summary: compact(article.body, 520), categories: [norm.category], source_url: sourceUrl,
      sha256: sha256(article.body), format: 'text', references: extractReferences(article.body),
      search_text: compact(`${norm.title} artículo ${article.number} ${versionLabel} ${article.body}`, 9000),
      content_path: `content/bcn/articulos/${baseSlug}/${articleId}.md`, norm_code: norm.code,
      idNorma: norm.idNorma, article: article.number, version: versionLabel, version_date: shownDate,
      valid_from: validFrom, valid_to: validUntil, historical_version: historical, future_version: future, deferred_by_event: byEvent, ...extra,
    }, article.body);
  }
  return articles.length;
}

// El texto vigente se indexa completo y por artículo (búsqueda granular); las versiones históricas
// se guardan como un documento por versión (texto completo) para mantener acotado el tamaño del corpus:
// cada norma tiene decenas de versiones históricas y explotarlas todas por artículo multiplicaría el
// corpus por miles de documentos sin aportar valor de búsqueda adicional sobre el texto vigente.
function modifierNorm(idNorma, metadatos, modifies) {
  const tipo = (Array.isArray(metadatos?.tipos_numeros) ? metadatos.tipos_numeros : [])[0] ?? {};
  const label = [tipo.descripcion, tipo.numero].filter(Boolean).join(' ') || `Norma ${idNorma}`;
  const code = String(tipo.compuesto || `NORMA-${idNorma}`).toUpperCase();
  const title = String(metadatos?.titulo_norma ?? '').replace(/\s+/g, ' ').trim();
  return {
    idNorma,
    code,
    // El número sólo es único dentro de su tipo y año (hay muchos "Decreto 75 EXENTO"): el id lleva
    // el idNorma de LeyChile para no pisar una norma con otra.
    slug: `${slug(code)}-${idNorma}`,
    number: tipo.numero ?? null,
    title: title ? `${label} — ${title}` : label,
    category: MODIFIERS_CATEGORY,
    extra: {
      date: metadatos?.fecha_publicacion ?? null,
      norm_kind: 'modificatoria',
      published_at: metadatos?.fecha_publicacion ?? null,
      modifies: [...modifies.keys()].sort(),
      effective_dates: [...new Set([...modifies.values()].flat())].sort(),
    },
  };
}

async function crawlModifiers({ modifiersById, onDocument, log }) {
  const stored = [];
  const missing = [];
  for (const [idNorma, { label, modifies }] of modifiersById) {
    const probe = { idNorma, code: label };
    const fetched = await fetchNormaApi(probe, null, log, MODIFIER_MIN);
    if (!fetched) {
      missing.push({ idNorma, label });
      continue;
    }
    const norm = modifierNorm(idNorma, fetched.metadatos, modifies);
    // Una ley modificatoria se publica en el Diario Oficial con su fecha; la "versión vigente" de
    // LeyChile no aporta un tramo útil, así que se fecha por publicación.
    const published = fetched.metadatos?.fecha_publicacion ?? null;
    await emitNorm({ norm, fetched: { ...fetched, metadatos: { ...fetched.metadatos, vigencia: null } }, onDocument });
    stored.push({ idNorma, label: norm.code, published });
  }
  return { stored, missing };
}

// El texto vigente se indexa completo y por artículo (búsqueda granular), igual que las versiones con
// vigencia diferida (es el texto que se va a aplicar). Las versiones históricas se guardan como un
// documento por versión (texto completo) para mantener acotado el tamaño del corpus: cada norma
// tiene decenas de versiones históricas y explotarlas todas por artículo multiplicaría el corpus
// por miles de documentos sin aportar valor de búsqueda adicional sobre el texto vigente.
export async function crawlBcn({ onDocument, log = console.log, includeHistory = false, includeModifiers = false, now = new Date() }) {
  const today = todayIso(now);
  const modifiersById = new Map();
  const baseIds = new Set(CORE_NORMS.map((n) => n.idNorma));
  const coverage = { base: [], modifiers_expected: 0, modifiers_stored: 0, missing: [], listing_errors: [], unavailable_in_leychile: [] };

  function addModifier(idNorma, label, baseCode, effective = []) {
    if (baseIds.has(idNorma)) return;
    const entry = modifiersById.get(idNorma) ?? { label, modifies: new Map() };
    if (baseCode) entry.modifies.set(baseCode, [...new Set([...(entry.modifies.get(baseCode) ?? []), ...effective])]);
    modifiersById.set(idNorma, entry);
  }

  for (const norm of CORE_NORMS) {
    log(`[BCN] ${norm.code} (${norm.idNorma}) vigente`);
    const current = await fetchNormaApi(norm, null, log);
    if (!current) {
      log(`[BCN] ${norm.code}: no se obtuvo texto estructurado vigente`);
      coverage.base.push({ code: norm.code, ok: false });
      continue;
    }
    const count = await emitNorm({ norm, fetched: current, onDocument });
    log(`[BCN] ${norm.code}: ${count} artículos vigentes indexados`);

    const currentHash = sha256(current.text);
    const future = futureVersionsFromMetadatos(current.metadatos, today);
    const futureStored = [];
    for (const { from, to, byEvent } of future) {
      const fetched = await fetchNormaApi(norm, from, log);
      if (!fetched) continue;
      if (sha256(fetched.text) === currentHash) continue;
      await emitNorm({ norm, fetched, onDocument, versionDate: from, validTo: to, future: true, byEvent });
      futureStored.push(from);
      log(`[BCN] ${norm.code} ${from}: versión con vigencia diferida indexada`);
    }
    coverage.base.push({ code: norm.code, ok: true, future_versions: future.map((v) => v.from), future_stored: futureStored });

    if (includeModifiers) {
      const listing = await listModifyingNorms(norm, log);
      if (!listing) coverage.listing_errors.push(norm.code);
      for (const m of listing?.modifiers ?? []) addModifier(m.idNorma, m.label, norm.code, m.effective);
      for (const label of listing?.unavailable ?? []) coverage.unavailable_in_leychile.push({ modifies: norm.code, label });
      log(`[BCN] ${norm.code}: ${listing?.modifiers.length ?? 0} normas modificatorias registradas en LeyChile`);
    }

    if (!includeHistory) continue;

    const versions = versionsFromMetadatos(current.metadatos, today);
    log(`[BCN] ${norm.code}: ${versions.length} versiones históricas detectadas`);
    let previousHash = currentHash;
    for (const { from, to } of versions) {
      const fetched = await fetchNormaApi(norm, from, log);
      if (!fetched) continue;
      const hash = sha256(fetched.text);
      if (hash === previousHash) continue;
      await emitNorm({ norm, fetched, onDocument, versionDate: from, validTo: to, historical: true });
      previousHash = hash;
      log(`[BCN] ${norm.code} ${from}: versión histórica indexada`);
    }
  }

  if (includeModifiers) {
    for (const law of PINNED_LAWS) addModifier(law.idNorma, law.label, null);
    const { stored, missing } = await crawlModifiers({ modifiersById, onDocument, log });
    coverage.modifiers_expected = modifiersById.size;
    coverage.modifiers_stored = stored.length;
    coverage.missing = missing;
    log(`[BCN] Normas modificatorias: ${stored.length} de ${modifiersById.size} guardadas`);
    for (const m of missing) log(`[BCN] FALTA norma modificatoria ${m.label} (idNorma ${m.idNorma})`);
  }
  return coverage;
}

export function splitArticlesForTests(text, options) { return splitArticles(text, options); }
export function textFromLeyChileJsonForTests(value) { return textFromLeyChileJson(value); }
export function versionsFromMetadatosForTests(metadatos, today) { return versionsFromMetadatos(metadatos, today); }
export function futureVersionsFromMetadatosForTests(metadatos, today) { return futureVersionsFromMetadatos(metadatos, today); }
