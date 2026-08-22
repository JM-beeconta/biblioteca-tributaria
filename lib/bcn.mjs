import { compact, decodeBuffer, extractReferences, fetchResource, sha256, slug, stripHtml } from './utils.mjs';

export const CORE_NORMS = [
  { idNorma: 6368, code: 'LIR', number: 824, title: 'Ley sobre Impuesto a la Renta', category: 'Renta' },
  { idNorma: 6369, code: 'LIVS', number: 825, title: 'Ley sobre Impuesto a las Ventas y Servicios', category: 'IVA' },
  { idNorma: 6374, code: 'CT', number: 830, title: 'Código Tributario', category: 'Código Tributario' },
];

const API_BASE = 'https://nuevo.leychile.cl/servicios';

function splitArticles(text) {
  const re = /(?:^|\n)\s*Art(?:í|i)culo\s+([0-9]+(?:\s*(?:bis|ter|quáter|quater|[A-Z]))?(?:[°º])?)[.°º-]*\s*/gim;
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
async function fetchNormaApi(norm, versionDate = null, log = console.log) {
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
  const articles = splitArticles(text);
  if (text.length < 3000 || articles.length < 10) {
    log(`[BCN] Contenido incompleto ${norm.code}${versionDate ? ` ${versionDate}` : ''}: ${text.length} caracteres, ${articles.length} artículos`);
    return null;
  }

  return { text, url: response.url, metadatos: parsed.metadatos, format: 'leychile-api' };
}

function versionsFromMetadatos(metadatos) {
  const vigencias = Array.isArray(metadatos?.vigencias) ? metadatos.vigencias : [];
  const seen = new Set();
  const versions = [];
  for (const v of vigencias) {
    const desde = v?.desde;
    if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || seen.has(desde)) continue;
    if (!v.hasta) continue; // versión abierta (vigente): ya cubierta por el fetch sin idVersion
    seen.add(desde);
    versions.push({ from: desde, to: v.hasta });
  }
  return versions.sort((a, b) => a.from.localeCompare(b.from));
}

async function emitNorm({ norm, fetched, onDocument, versionDate = null, validTo = null, historical = false }) {
  const text = fetched.text.trim();
  const articles = historical ? [] : splitArticles(text);

  const versionLabel = versionDate ? `Versión desde ${versionDate}${validTo ? ` hasta ${validTo}` : ''}` : 'Versión vigente consultada en LeyChile';
  const suffix = versionDate ? `-v-${versionDate}` : '';
  const normId = `bcn-${norm.code.toLowerCase()}${suffix}`;
  const year = versionDate
    ? Number(versionDate.slice(0, 4))
    : Number(fetched.metadatos?.fecha_publicacion?.slice(0, 4)) || 1974;
  const sourceUrl = navegarUrl(norm, versionDate);

  await onDocument({
    id: normId, source: 'BCN', type: 'norma', number: norm.number, year, date: versionDate,
    title: `${norm.title}${versionDate ? ` — versión ${versionDate}` : ''}`,
    summary: `Texto legal oficial de LeyChile. ${versionLabel}.`, categories: [norm.category], source_url: sourceUrl,
    sha256: sha256(text), format: fetched.format, references: extractReferences(text),
    search_text: compact(`${norm.title} ${versionLabel} ${text}`, 9000), content_path: `content/bcn/normas/${normId}.md`,
    norm_code: norm.code, idNorma: norm.idNorma, version: versionLabel, version_date: versionDate,
    valid_from: versionDate, valid_to: validTo, historical_version: historical,
  }, text);

  const articleOccurrences = new Map();
  for (const article of articles) {
    // DL 824 y otras normas usan "doble articulado" (un artículo único del decreto que aprueba el
    // texto de la ley, cuyos propios artículos reinician la numeración) y artículos transitorios que
    // también repiten números 1..N — sin desambiguar, el segundo/tercer "Artículo 1" pisaría al primero.
    const baseSlug = slug(article.number);
    const occurrence = (articleOccurrences.get(baseSlug) ?? 0) + 1;
    articleOccurrences.set(baseSlug, occurrence);
    const articleId = occurrence > 1 ? `${normId}-art-${baseSlug}-${occurrence}` : `${normId}-art-${baseSlug}`;
    await onDocument({
      id: articleId, source: 'BCN', type: 'articulo', number: article.number, year, date: versionDate,
      title: `Artículo ${article.number} — ${norm.title}${versionDate ? ` · versión ${versionDate}` : ''}`,
      summary: compact(article.body, 520), categories: [norm.category], source_url: sourceUrl,
      sha256: sha256(article.body), format: 'text', references: extractReferences(article.body),
      search_text: compact(`${norm.title} artículo ${article.number} ${versionLabel} ${article.body}`, 9000),
      content_path: `content/bcn/articulos/${norm.code.toLowerCase()}/${articleId}.md`, norm_code: norm.code,
      idNorma: norm.idNorma, article: article.number, version: versionLabel, version_date: versionDate,
      valid_from: versionDate, valid_to: validTo, historical_version: historical,
    }, article.body);
  }
  return articles.length;
}

// El texto vigente se indexa completo y por artículo (búsqueda granular); las versiones históricas
// se guardan como un documento por versión (texto completo) para mantener acotado el tamaño del corpus:
// cada norma tiene decenas de versiones históricas y explotarlas todas por artículo multiplicaría el
// corpus por miles de documentos sin aportar valor de búsqueda adicional sobre el texto vigente.
export async function crawlBcn({ onDocument, log = console.log, includeHistory = false }) {
  for (const norm of CORE_NORMS) {
    log(`[BCN] ${norm.code} (${norm.idNorma}) vigente`);
    const current = await fetchNormaApi(norm, null, log);
    if (!current) {
      log(`[BCN] ${norm.code}: no se obtuvo texto estructurado vigente`);
      continue;
    }
    const count = await emitNorm({ norm, fetched: current, onDocument });
    log(`[BCN] ${norm.code}: ${count} artículos vigentes indexados`);

    if (!includeHistory) continue;

    const versions = versionsFromMetadatos(current.metadatos);
    log(`[BCN] ${norm.code}: ${versions.length} versiones históricas detectadas`);
    let previousHash = sha256(current.text);
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
}

export function splitArticlesForTests(text) { return splitArticles(text); }
export function textFromLeyChileJsonForTests(value) { return textFromLeyChileJson(value); }
export function versionsFromMetadatosForTests(metadatos) { return versionsFromMetadatos(metadatos); }
