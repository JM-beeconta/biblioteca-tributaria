import { MONTHS_ES, compact, decodeBuffer, extractAnchors, extractDocumentText, extractReferences, fetchResource, inferDate, normalizeText, sha256 } from './utils.mjs';

const LIST_API = 'https://www3.sii.cl/getPublicacionesCTByMateria';
const DOWNLOAD_API = 'https://www4.sii.cl/gabineteAdmInternet/descargaArchivo';

const SOURCE_SETS = [
  {
    category: 'Renta',
    type: 'oficio',
    apiKey: 'RENTA',
    startYear: 1975,
    modernUrl: (year) => `https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/${year}/ley_impuesto_renta_jadm${year}.htm`,
    legacyUrl: (year) => `https://www.sii.cl/pagina/jurisprudencia/adminis/${year}/ley_renta${year}.htm`,
    aggregateUrl: 'https://www.sii.cl/pagina/jurisprudencia/adminis/anteriores/anteriores_renta.htm',
  },
  {
    category: 'IVA',
    type: 'oficio',
    apiKey: 'IVA',
    startYear: 1975,
    modernUrl: (year) => `https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_ventas/${year}/ley_impuesto_ventas_jadm${year}.htm`,
    legacyUrl: (year) => `https://www.sii.cl/pagina/jurisprudencia/adminis/${year}/ventas_servicios${year}.htm`,
    aggregateUrl: 'https://www.sii.cl/pagina/jurisprudencia/adminis/anteriores/anteriores_ventas.htm',
  },
  {
    category: 'Otras Normas',
    type: 'oficio',
    apiKey: 'OTROS',
    startYear: 1975,
    modernUrl: (year) => `https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/otras_normas/${year}/otras_normas_jadm${year}.htm`,
    legacyUrl: (year) => `https://www.sii.cl/pagina/jurisprudencia/adminis/${year}/otros${year}.htm`,
    aggregateUrl: 'https://www.sii.cl/pagina/jurisprudencia/adminis/anteriores/anos_anteriores.htm',
  },
  {
    category: 'Circulares',
    type: 'circular',
    startYear: 1974,
    simpleIndex: true,
    modernUrl: (year) => `https://www.sii.cl/normativa_legislacion/circulares/${year}/indcir${year}.htm`,
    // Hasta 2012 el índice vive en /documentos/circulares/ (la ruta moderna da 404). Antes de 2000
    // esa página sólo redirige por JavaScript a indcirAA.htm: fetchIndex sigue esa redirección.
    legacyUrl: (year) => `https://www.sii.cl/documentos/circulares/${year}/indcir${year}.htm`,
    legacyUntil: 2012,
  },
  {
    // Resoluciones Exentas: fija procedimientos, nóminas (grandes contribuyentes), condonaciones,
    // formularios, etc. El índice sólo existe con este patrón desde 2013 (años previos dan 404 y
    // no hay una página histórica agregada equivalente a la de Oficios/Circulares).
    category: 'Resoluciones',
    type: 'resolucion',
    startYear: 2013,
    simpleIndex: true,
    modernUrl: (year) => `https://www.sii.cl/normativa_legislacion/resoluciones/${year}/res_ind${year}.htm`,
  },
];

const TYPE_META = {
  circular: { label: 'Circular', folder: 'circulares', textRe: /circular\s+n?[°ºo]?\s*\d+/i, pathRe: /circu(?:lar)?[_-]?\d+/i },
  resolucion: { label: 'Resolución', folder: 'resoluciones', textRe: /resoluci[oó]n\s+(?:exenta\s+)?(?:sii\s+)?n?[°ºo]?\s*\d+/i, pathRe: /reso(?:lucion)?[_-]?\d+/i },
  oficio: { label: 'Oficio', folder: 'oficios', textRe: /oficio\s+(?:ord(?:inario)?\.?\s*)?n?[°ºo]?\s*\d+/i, pathRe: /(?:oficio|of|ord)[_-]?\d+/i },
};

function typeMeta(type) {
  return TYPE_META[type] ?? TYPE_META.oficio;
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function extractDynamicConfig(html) {
  if (!/getPublicacionesCTByMateria/i.test(html)) return null;
  const direct = html.match(/data\s*:\s*'\s*\{\s*"key"\s*:\s*"([^"]+)"\s*,\s*"year"\s*:\s*"(\d{4})"\s*\}\s*'/i);
  if (direct) return { key: direct[1], year: Number(direct[2]) };
  const key = (html.match(/"key"\s*:\s*"([^"]+)"/i) ?? [])[1];
  const year = Number((html.match(/"year"\s*:\s*"(\d{4})"/i) ?? [])[1]);
  return key && year ? { key, year } : null;
}

function buildDownloadUrl(row) {
  const extension = row.extensionArchPublica || 'pdf';
  const filename = `${row.pubNumOficio}-${row.pubFechaPubli}.${extension}`;
  const params = new URLSearchParams({
    nombreDocumento: filename,
    extension,
    acc: 'download',
    id: String(row.idBlobArchPublica ?? ''),
    mediaType: row.mTypeArchPublica || 'application/pdf',
  });
  return `${DOWNLOAD_API}?${params.toString()}`;
}

async function listDynamicOficios(config, log) {
  try {
    const response = await fetch(LIST_API, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'BeecontaBibliotecaTributaria/0.6 (+https://github.com/JM-beeconta/biblioteca-tributaria)',
      },
      body: JSON.stringify({ key: config.key, year: String(config.year) }),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    log(`[SII] Error API ${config.key}/${config.year}: ${error.message}`);
    return [];
  }
}

// En Jurisprudencia Administrativa cada oficio es un archivo jaNNNN.(htm|doc|pdf) y NNNN es su
// número de Ord. (verificado contra el texto: ja2404 = "Ord. Nº 2404", ja4936 = "Ord. N° 4.936").
// El número del archivo es la única fuente confiable: el texto del índice cita primero otros oficios
// ("OFICIO N° 1638, DE 2010") y tomarlo de ahí renumeraba y fusionaba oficios distintos.
const JA_FILE_RE = /\/ja(\d{1,6})\.(?:htm|html|doc|docx|pdf|rtf)$/i;

function jaNumber(url) {
  try {
    const match = new URL(url).pathname.match(JA_FILE_RE);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// La cita propia de cada oficio en el índice va entre paréntesis: "(Ord. N° 4.936, de 28.12.2000)",
// "(Ord. Nº 2404, de 23-12-2010)", "(Of. N° 4.604, de 29.11.2000 – I. Directos)". Las citas a otros
// oficios van sin paréntesis y con la palabra completa ("OFICIO N° 1638, DE 2010").
// Variantes reales: "(Ord. Nº 2404, de 23-12-2010)", "(Of. N° 4.604, de 29.11.2000 – I. Directos)",
// "(Oficio N° 3.521, de 19.12.96)", "(Ordinario N° 3532 de 29-12-1998)", "(Oficio N° 3448, de 17
// Diciembre 1998)". Se toma la ÚLTIMA cita entre paréntesis del texto que sigue al enlace: la propia
// cierra la entrada; una cita anterior dentro del resumen sería de otro oficio.
// Entre 1994 y 1999 la cita suele ir sin paréntesis al final ("…Oficio N° 3.788, de 18.12.95"): sin
// paréntesis sólo se acepta si cierra la entrada (últimos caracteres) y trae fecha completa.
const OWN_CITATION_RE = /(\(\s*)?(?:Ord(?:inario)?|Of(?:icio)?)\.?\s*N[°ºo]?\.?\s*(\d{1,3}(?:\.\d{3})+|\d{1,6})\s*,?\s*(?:de\s+)?([^)\n]{0,40})/gi;
const TRAILING_CITATION_CHARS = 60;

function citationDate(text = '') {
  let m = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}|\d{2})\b/);
  let d;
  let mo;
  let y;
  if (m) {
    [, d, mo, y] = m;
  } else {
    m = text.match(/^(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\s+(?:de\s+|del\s+)?(\d{4})/i);
    if (!m) return null;
    d = m[1];
    mo = String(MONTHS_ES[normalizeText(m[2])] ?? '');
    y = m[3];
  }
  if (y.length === 2) y = `${Number(y) > 50 ? '19' : '20'}${y}`;
  if (!(Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function ownCitation(text = '') {
  const clean = text.trim();
  const matches = [...clean.matchAll(OWN_CITATION_RE)];
  const m = matches.at(-1);
  if (!m) return { number: null, date: null };
  const trailing = clean.length - (m.index + m[0].length) <= TRAILING_CITATION_CHARS;
  const date = citationDate(m[3].trim());
  // Sin paréntesis, además, debe traer fecha completa: la propia la trae ("de 18.12.95"); una cita a
  // otro oficio en el resumen suele ir sólo con el año ("Oficio N° 99, de 1990").
  if (!m[1] && (!trailing || !date)) return { number: null, date: null };
  const number = Number(m[2].replace(/\./g, ''));
  return { number: number || null, date };
}

// Un oficio publicado como renta14.htm + renta14.doc (o ja2404.htm + ja2404.doc) es un solo
// documento: se agrupa por carpeta + nombre sin extensión.
const DOCUMENT_EXT_RE = /\.(?:htm|html|doc|docx|pdf|rtf)$/i;

function documentStem(url) {
  try {
    const parts = new URL(url).pathname.split('/');
    return `${parts.at(-2) ?? ''}/${(parts.at(-1) ?? '').replace(DOCUMENT_EXT_RE, '')}`.toLowerCase();
  } catch {
    return url;
  }
}

function extractNumber(text, type, url) {
  if (type === 'oficio') {
    const fromFile = jaNumber(url);
    if (fromFile) return fromFile;
  }
  const { label } = typeMeta(type);
  let m = text.match(new RegExp(`${label}\\s+(?:Exenta\\s+)?(?:SII\\s+)?(?:Ord(?:inario)?\\.?\\s*)?N[°ºo]?\\s*(\\d{1,6})`, 'i'));
  if (m) return Number(m[1]);
  const file = new URL(url).pathname.split('/').pop() ?? '';
  if (type === 'circular') m = file.match(/circu(?:lar)?[_-]?(\d{1,4})/i);
  else if (type === 'resolucion') m = file.match(/reso(?:lucion)?[_-]?(\d{1,6})/i);
  else m = file.match(/(?:oficio|of|ord)[_-]?(\d{1,6})/i);
  return m ? Number(m[1]) : null;
}

function meaningfulCandidate(anchor, source, indexUrl) {
  const url = new URL(anchor.url);
  if (anchor.url === indexUrl) return false;
  if (!/sii\.cl$/i.test(url.hostname)) return false;
  if (/\.(?:css|js|png|jpe?g|gif|svg|ico|zip|xls|xlsx)$/i.test(url.pathname)) return false;
  if (/indice_jadm|jadm\d{4}\.htm$/i.test(url.pathname)) return false;
  const text = `${anchor.label} ${anchor.context}`;
  const { textRe, pathRe } = typeMeta(source.type);
  if (source.type !== 'oficio') return textRe.test(text) || pathRe.test(url.pathname);
  return JA_FILE_RE.test(url.pathname) || textRe.test(text) || pathRe.test(url.pathname) || /jurisprudencia\/adminis/i.test(url.pathname);
}

function inferSummary(context, type, number) {
  let value = context;
  if (number) {
    const { label } = typeMeta(type);
    value = value.replace(new RegExp(`${label}\\s+(?:Exenta\\s+)?(?:SII\\s+)?(?:Ord(?:inario)?\\.?\\s*)?N[°ºo]?\\s*${number}[^.\\n]*`, 'i'), '');
  }
  return compact(value, 520);
}

async function fetchDocumentText(url) {
  const response = await fetchResource(url, { retries: 2, delayMs: 650, timeoutMs: 30000 });
  if (!response) return null;
  const extracted = await extractDocumentText(response);
  return {
    text: extracted.text,
    hash: sha256(response.buffer),
    finalUrl: response.url,
    format: extracted.format,
    buffer: response.buffer,
  };
}

// Extensión con la que se archiva el original tal como lo publicó el SII (ver export-range.mjs).
const ORIGINAL_EXT = { pdf: 'pdf', doc: 'doc', docx: 'docx', rtf: 'rtf', html: 'htm', text: 'txt' };

// Para un mismo oficio el SII publica la ficha .htm y una copia .doc/.pdf: se guarda uno solo,
// con la .htm como fuente (texto directo) y las demás como respaldo.
function formatRank(url = '') {
  if (/\.html?$/i.test(url)) return 0;
  if (/\.pdf$/i.test(url)) return 1;
  return 2;
}

function mergeShell(map, key, shell) {
  const existing = map.get(key);
  if (existing) {
    for (const category of shell.categories) existing.categories.add(category);
    // El número y la fecha propios suelen venir en el texto que sigue al segundo enlace (.doc).
    if (!existing.number && shell.number) existing.number = shell.number;
    if (!existing.date_hint && shell.date_hint) existing.date_hint = shell.date_hint;
    if (shell.context && existing.context && !existing.context.includes(shell.context)) {
      existing.context = `${existing.context}\n${shell.context}`;
    }
    if (shell.source_url && shell.source_url !== existing.source_url) {
      const alternates = new Set([...(existing.alternate_urls ?? []), ...(shell.alternate_urls ?? [])]);
      if (formatRank(shell.source_url) < formatRank(existing.source_url)) {
        alternates.add(existing.source_url);
        existing.source_url = shell.source_url;
      } else {
        alternates.add(shell.source_url);
      }
      alternates.delete(existing.source_url);
      existing.alternate_urls = [...alternates];
    }
    if (!existing.context && shell.context) existing.context = shell.context;
    if (!existing.legal && shell.legal) existing.legal = shell.legal;
    if (!existing.summary && shell.summary) existing.summary = shell.summary;
    return;
  }
  map.set(key, shell);
}

async function collectDynamic(source, year, indexUrl, html, shells, log) {
  const discovered = extractDynamicConfig(html);
  const key = source.apiKey || discovered?.key;
  if (!key) return false;

  const rows = await listDynamicOficios({ key, year }, log);
  log(`[SII] API ${source.category} ${year}: ${rows.length} publicaciones`);
  if (!rows.length) return false;

  for (const row of rows) {
    const number = Number(row.pubNumOficio) || null;
    const downloadUrl = buildDownloadUrl(row);
    const blobId = String(row.idBlobArchPublica ?? '');
    const keyId = blobId ? `blob:${blobId}` : downloadUrl;
    mergeShell(shells, keyId, {
      source: 'SII',
      type: 'oficio',
      year,
      number,
      categories: new Set([source.category]),
      context: compact(`${row.pubLegal ?? ''} ${row.pubResumen ?? ''}`, 1200),
      legal: row.pubLegal ?? '',
      summary: row.pubResumen ?? '',
      date_hint: row.pubFechaPubli ?? '',
      source_url: downloadUrl,
      index_url: indexUrl,
      blob_id: blobId || null,
    });
  }
  return true;
}

function collectHtmlCandidates(source, year, indexUrl, html, shells, allowedYears = null) {
  const candidates = extractAnchors(html, indexUrl).filter((anchor) => meaningfulCandidate(anchor, source, indexUrl));
  for (const candidate of candidates) {
    const canonical = candidate.url.split('#')[0];
    const isDocument = DOCUMENT_EXT_RE.test(new URL(canonical).pathname);
    // En un índice anual (year conocido) el año es el de la página: una fecha del contexto suele ser
    // la de una norma citada y antes mandaba el oficio a otro año, o lo descartaba.
    const annualOficio = source.type === 'oficio' && Boolean(year) && isDocument;
    const own = source.type === 'oficio' ? ownCitation(candidate.after ?? candidate.context) : { number: null, date: null };
    // La numeración de oficios se reinicia cada año: un oficio de diciembre publicado en el índice
    // del año siguiente se identifica por el año de su propia cita, no por el de la página.
    const ownYear = own.date ? Number(own.date.slice(0, 4)) : null;
    const hintedDate = annualOficio ? null : own.date ?? inferDate(candidate.context, null);
    const hintedYear = annualOficio ? (ownYear && Math.abs(ownYear - year) <= 1 ? ownYear : year) : hintedDate ? Number(hintedDate.slice(0, 4)) : year;
    if (allowedYears && hintedYear && !allowedYears.has(hintedYear)) continue;
    const ja = source.type === 'oficio' ? jaNumber(canonical) : null;
    const number = ja ?? own.number ?? (annualOficio ? null : extractNumber(`${candidate.label} ${candidate.context}`, source.type, canonical));
    const groupByStem = isDocument && hintedYear && (annualOficio || source.simpleIndex);
    const key = groupByStem ? `${source.type}|${hintedYear}|${documentStem(canonical)}` : canonical;
    mergeShell(shells, key, {
      source: 'SII',
      type: source.type,
      year: hintedYear || year,
      year_locked: annualOficio,
      date_hint: own.date && Number(own.date.slice(0, 4)) === hintedYear ? own.date : '',
      number,
      categories: new Set([source.category]),
      context: candidate.context,
      source_url: canonical,
      index_url: indexUrl,
    });
  }
  return candidates.length;
}

// Índices antiguos del SII que sólo contienen window.location.replace("indcir90.htm").
function jsRedirectTarget(html, baseUrl) {
  if (html.length > 2000) return null;
  const target = (html.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i) ?? [])[1];
  if (!target) return null;
  try { return new URL(target, baseUrl).toString(); } catch { return null; }
}

async function fetchIndex(url, log, hops = 0) {
  try {
    const response = await fetchResource(url, { retries: 2, delayMs: 300, timeoutMs: 20000 });
    if (!response) return null;
    const html = decodeBuffer(response.buffer, response.contentType);
    const redirect = hops < 2 ? jsRedirectTarget(html, response.url) : null;
    if (redirect && redirect !== response.url) return fetchIndex(redirect, log, hops + 1);
    return { response, html };
  } catch (error) {
    log(`[SII] Saltando ${url}: ${error.message}`);
    return null;
  }
}

// Fase de descubrimiento (qué documentos existen) separada de la de extracción (bajar y leer cada
// uno) para poder auditar cobertura contra la fuente real sin pagar el costo de descargar y
// procesar miles de PDF/DOC — una auditoría sólo necesita saber cuántos candidatos hay por
// año/categoría, no su texto completo.
export async function discoverSii({ years, log = console.log, categories = null }) {
  const currentYear = new Date().getFullYear();
  const requestedYears = new Set(years);
  const shells = new Map();

  for (const source of SOURCE_SETS) {
    if (categories && !categories.includes(source.category)) continue;
    const sourceYears = years.filter((year) => year >= source.startYear && year <= currentYear);

    if (source.simpleIndex) {
      for (const year of sourceYears) {
        const indexUrl = source.legacyUrl && year <= source.legacyUntil ? source.legacyUrl(year) : source.modernUrl(year);
        log(`[SII] Índice ${source.category} ${year}`);
        const index = await fetchIndex(indexUrl, log);
        if (index) collectHtmlCandidates(source, year, index.response.url, index.html, shells);
      }
      continue;
    }

    const annualYears = sourceYears.filter((year) => year >= 1994);
    for (const year of annualYears) {
      let handled = false;
      const preferredUrl = year <= 2009 ? source.legacyUrl(year) : source.modernUrl(year);
      log(`[SII] Índice ${source.category} ${year}`);
      let index = await fetchIndex(preferredUrl, log);

      if (index) {
        handled = await collectDynamic(source, year, index.response.url, index.html, shells, log);
        if (!handled) handled = collectHtmlCandidates(source, year, index.response.url, index.html, shells) > 0;
      }

      if (!handled) {
        const fallbackUrl = preferredUrl === source.modernUrl(year) ? source.legacyUrl(year) : source.modernUrl(year);
        index = await fetchIndex(fallbackUrl, log);
        if (index) {
          handled = await collectDynamic(source, year, index.response.url, index.html, shells, log);
          if (!handled) collectHtmlCandidates(source, year, index.response.url, index.html, shells);
        }
      }
    }

    const earlyYears = sourceYears.filter((year) => year <= 1993);
    if (earlyYears.length && source.aggregateUrl) {
      log(`[SII] Índice histórico agregado ${source.category}`);
      const index = await fetchIndex(source.aggregateUrl, log);
      if (index) collectHtmlCandidates(source, null, index.response.url, index.html, shells, requestedYears);
    }
  }

  // En un índice anual de oficios, un enlace sin número propio (ni jaNNNN ni "(Ord./Of. N° …)") es
  // navegación (otros años, "Años anteriores"), no un oficio.
  const allShells = [...shells.values()].filter((shell) => !(shell.type === 'oficio' && shell.year_locked && !shell.number));
  log(`[SII] ${allShells.length} documentos candidatos para ${years.at(-1)}-${years[0]}`);
  return allShells;
}

export async function crawlSii({ years, onDocument, log = console.log, categories = null }) {
  const requestedYears = new Set(years);
  const allShells = await discoverSii({ years, log, categories });

  await mapWithConcurrency(allShells, 2, async (shell) => {
    log(`[SII] Documento ${shell.type} ${shell.number ?? ''}/${shell.year ?? ''}`);
    let extracted;
    try { extracted = await fetchDocumentText(shell.source_url); }
    catch (error) { log(`[SII] Error documento ${shell.source_url}: ${error.message}`); extracted = null; }

    const extractedText = extracted?.text?.trim() || '';
    const text = extractedText || shell.context || shell.summary || shell.legal || '';
    let date = inferDate(`${shell.date_hint ?? ''}\n${shell.context ?? ''}\n${text.slice(0, 1200)}`, shell.year);
    if (shell.year_locked) {
      // El año viene del índice anual; una fecha de otro año es la de una norma citada.
      date = shell.date_hint || (date && Number(date.slice(0, 4)) === shell.year ? date : null);
    }
    const actualYear = shell.year_locked ? shell.year : date ? Number(date.slice(0, 4)) : shell.year;
    // Un oficio con año fijado por su propia cita (p.ej. de diciembre, publicado en el índice del año
    // siguiente) se conserva aunque ese año no esté en el tramo pedido: no vuelve a aparecer en otro.
    if (actualYear && !requestedYears.has(actualYear) && !shell.year_locked) return;

    const number = shell.number ?? extractNumber(text.slice(0, 1600), shell.type, shell.source_url);
    const titlePrefix = typeMeta(shell.type).label;
    const summary = compact(shell.summary || inferSummary(shell.context ?? '', shell.type, number) || text, 520);
    const hash = extracted?.hash ?? sha256(`${shell.source_url}|${shell.context ?? ''}`);
    const id = `sii-${shell.type}-${actualYear ?? 's-f'}-${number ?? shell.blob_id ?? sha256(shell.source_url).slice(0, 10)}`;
    const doc = {
      id,
      source: 'SII',
      type: shell.type,
      number,
      year: actualYear,
      date,
      title: `${titlePrefix}${number ? ` N° ${number}` : ''}${actualYear ? ` de ${actualYear}` : ''}`,
      summary,
      categories: [...shell.categories],
      source_url: shell.source_url,
      index_url: shell.index_url ?? null,
      sha256: hash,
      format: extracted?.format ?? 'metadata',
      extraction_status: extractedText.length >= 80 ? 'full' : extractedText.length ? 'partial' : 'metadata_only',
      text_length: extractedText.length,
      references: extractReferences(`${shell.legal ?? ''}\n${text}`),
      search_text: compact(`${shell.legal ?? ''} ${summary} ${text}`, 9000),
      content_path: `content/sii/${typeMeta(shell.type).folder}/${actualYear ?? 'sin-fecha'}/${id}.md`,
      blob_id: shell.blob_id ?? null,
      ...(shell.alternate_urls?.length ? { alternate_urls: shell.alternate_urls } : {}),
    };
    const ext = extracted?.buffer?.length ? ORIGINAL_EXT[extracted.format] : null;
    const original = ext ? { buffer: extracted.buffer, name: `${id}.${ext}` } : null;
    if (original) {
      doc.original_file = { name: original.name, sha256: hash, bytes: extracted.buffer.length, source_url: extracted.finalUrl };
    }
    await onDocument(doc, text || 'Documento indexado por metadata oficial del SII; texto completo no disponible en esta ejecución.', original);
  });
}

export function sourceSetsForTests() {
  return SOURCE_SETS;
}

export function extractDynamicConfigForTests(html) {
  return extractDynamicConfig(html);
}

export function buildDownloadUrlForTests(row) {
  return buildDownloadUrl(row);
}

export function extractNumberForTests(text, type, url) {
  return extractNumber(text, type, url);
}

export function meaningfulCandidateForTests(anchor, source, indexUrl) {
  return meaningfulCandidate(anchor, source, indexUrl);
}
