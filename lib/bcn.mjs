import { compact, decodeBuffer, extractReferences, fetchResource, sha256, slug, stripHtml } from './utils.mjs';

export const CORE_NORMS = [
  { idNorma: 6368, code: 'LIR', number: 824, title: 'Ley sobre Impuesto a la Renta', category: 'Renta' },
  { idNorma: 6369, code: 'LIVS', number: 825, title: 'Ley sobre Impuesto a las Ventas y Servicios', category: 'IVA' },
  { idNorma: 6374, code: 'CT', number: 830, title: 'Código Tributario', category: 'Código Tributario' },
];

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
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsFromJson(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) stringsFromJson(item, output);
  }
  return output;
}

function textFromLeyChileJson(value) {
  const pieces = stringsFromJson(value);
  if (!pieces.length) return '';
  const longest = [...pieces].sort((a, b) => b.length - a.length)[0];
  if (longest.length >= 4000) return longest;
  return [...new Set(pieces)].join('\n\n');
}

async function fetchJsonNorm(norm, versionDate = null, log = console.log) {
  const params = new URLSearchParams({ idNorma: String(norm.idNorma), opt: '1' });
  if (versionDate) params.set('idVersion', versionDate);
  const url = `https://www.bcn.cl/leychile/Navegar/get_norma_json?${params}`;
  try {
    const response = await fetchResource(url, {
      retries: 3,
      delayMs: 350,
      timeoutMs: 30000,
      headers: {
        accept: 'application/json,text/plain,*/*',
        'x-requested-with': 'XMLHttpRequest',
        referer: `https://www.bcn.cl/leychile/navegar?idNorma=${norm.idNorma}`,
      },
    });
    if (!response) return null;
    const raw = decodeBuffer(response.buffer, response.contentType);
    const json = JSON.parse(raw);
    const text = textFromLeyChileJson(json);
    return { text, url: response.url, raw };
  } catch (error) {
    log(`[BCN] API JSON ${norm.code}${versionDate ? ` ${versionDate}` : ''}: ${error.message}`);
    return null;
  }
}

async function fetchHtmlNorm(norm, versionDate = null, log = console.log) {
  const params = new URLSearchParams({ idNorma: String(norm.idNorma) });
  if (versionDate) {
    params.set('idVersion', versionDate);
    params.set('tipoVersion', '');
  }
  const url = `https://www.bcn.cl/leychile/navegar?${params}`;
  try {
    const response = await fetchResource(url, { retries: 2, delayMs: 350, timeoutMs: 30000 });
    if (!response) return null;
    const raw = decodeBuffer(response.buffer, response.contentType);
    return { text: stripHtml(raw), url: response.url, raw };
  } catch (error) {
    log(`[BCN] HTML ${norm.code}${versionDate ? ` ${versionDate}` : ''}: ${error.message}`);
    return null;
  }
}

async function fetchNorm(norm, versionDate = null, log = console.log) {
  const json = await fetchJsonNorm(norm, versionDate, log);
  if (json && splitArticles(json.text).length >= 10) return { ...json, format: 'json' };
  const html = await fetchHtmlNorm(norm, versionDate, log);
  if (html && splitArticles(html.text).length >= 10 && !/este proceso demora demasiado/i.test(html.text)) return { ...html, format: 'html' };
  return null;
}

async function discoverVersions(norm, log = console.log) {
  const dates = new Set();
  const sources = [
    `https://www.bcn.cl/leychile/navegar?idNorma=${norm.idNorma}`,
    `https://www.bcn.cl/leychile/servicio/80/?idNorma=${norm.idNorma}`,
  ];

  for (const url of sources) {
    try {
      const response = await fetchResource(url, { retries: 2, delayMs: 250, timeoutMs: 25000 });
      if (!response) continue;
      const raw = decodeBuffer(response.buffer, response.contentType);
      for (const match of raw.matchAll(/(?:19|20)\d{2}-\d{2}-\d{2}/g)) dates.add(match[0]);
      for (const match of raw.matchAll(/idVersion(?:=|%3D)(\d{4}-\d{2}-\d{2})/gi)) dates.add(match[1]);
    } catch (error) {
      log(`[BCN] Versiones ${norm.code}: ${error.message}`);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  return [...dates]
    .filter((date) => date >= '1974-01-01' && date <= today)
    .sort();
}

function previousDay(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

async function emitNorm({ norm, fetched, onDocument, versionDate = null, validTo = null, historical = false }) {
  const text = fetched.text.trim();
  const articles = splitArticles(text);
  if (text.length < 3000 || articles.length < 10) return 0;

  const versionLabel = versionDate ? `Versión desde ${versionDate}${validTo ? ` hasta ${validTo}` : ''}` : 'Versión vigente consultada en LeyChile';
  const suffix = versionDate ? `-v-${versionDate}` : '';
  const normId = `bcn-${norm.code.toLowerCase()}${suffix}`;
  const year = versionDate ? Number(versionDate.slice(0, 4)) : Number((text.match(/(?:Publicación|Publicacion):?[^\d]*(\d{4})/i) ?? [])[1]) || 1974;
  const sourceUrl = versionDate
    ? `https://www.bcn.cl/leychile/navegar?idNorma=${norm.idNorma}&idVersion=${versionDate}&tipoVersion=`
    : `https://www.bcn.cl/leychile/navegar?idNorma=${norm.idNorma}`;

  const normDoc = {
    id: normId,
    source: 'BCN',
    type: 'norma',
    number: norm.number,
    year,
    date: versionDate,
    title: `${norm.title}${versionDate ? ` — versión ${versionDate}` : ''}`,
    summary: `Texto legal oficial de LeyChile. ${versionLabel}.`,
    categories: [norm.category],
    source_url: sourceUrl,
    sha256: sha256(text),
    format: fetched.format,
    references: extractReferences(text),
    search_text: compact(`${norm.title} ${versionLabel} ${text}`, 9000),
    content_path: `content/bcn/normas/${normId}.md`,
    norm_code: norm.code,
    idNorma: norm.idNorma,
    version: versionLabel,
    version_date: versionDate,
    valid_from: versionDate,
    valid_to: validTo,
    historical_version: historical,
  };
  await onDocument(normDoc, text);

  for (const article of articles) {
    const articleId = `${normId}-art-${slug(article.number)}`;
    await onDocument({
      id: articleId,
      source: 'BCN',
      type: 'articulo',
      number: article.number,
      year,
      date: versionDate,
      title: `Artículo ${article.number} — ${norm.title}${versionDate ? ` · versión ${versionDate}` : ''}`,
      summary: compact(article.body, 520),
      categories: [norm.category],
      source_url: sourceUrl,
      sha256: sha256(article.body),
      format: 'text',
      references: extractReferences(article.body),
      search_text: compact(`${norm.title} artículo ${article.number} ${versionLabel} ${article.body}`, 9000),
      content_path: `content/bcn/articulos/${norm.code.toLowerCase()}/${articleId}.md`,
      norm_code: norm.code,
      idNorma: norm.idNorma,
      article: article.number,
      version: versionLabel,
      version_date: versionDate,
      valid_from: versionDate,
      valid_to: validTo,
      historical_version: historical,
    }, article.body);
  }
  return articles.length;
}

export async function crawlBcn({ onDocument, log = console.log, includeHistory = false }) {
  for (const norm of CORE_NORMS) {
    log(`[BCN] ${norm.code} (${norm.idNorma}) vigente`);
    const current = await fetchNorm(norm, null, log);
    if (current) {
      const count = await emitNorm({ norm, fetched: current, onDocument });
      log(`[BCN] ${norm.code}: ${count} artículos vigentes indexados`);
    } else {
      log(`[BCN] ${norm.code}: no se obtuvo texto estructurado vigente`);
    }

    if (!includeHistory) continue;
    const versions = await discoverVersions(norm, log);
    log(`[BCN] ${norm.code}: ${versions.length} fechas de versión detectadas`);
    let lastHash = current?.text ? sha256(current.text.trim()) : null;

    for (let index = 0; index < versions.length; index++) {
      const versionDate = versions[index];
      const validTo = index + 1 < versions.length ? previousDay(versions[index + 1]) : null;
      const fetched = await fetchNorm(norm, versionDate, log);
      if (!fetched) continue;
      const hash = sha256(fetched.text.trim());
      if (hash === lastHash && index === versions.length - 1) continue;
      const count = await emitNorm({ norm, fetched, onDocument, versionDate, validTo, historical: true });
      if (count) lastHash = hash;
      log(`[BCN] ${norm.code} ${versionDate}: ${count} artículos`);
    }
  }
}

export function splitArticlesForTests(text) {
  return splitArticles(text);
}

export function textFromLeyChileJsonForTests(value) {
  return textFromLeyChileJson(value);
}
