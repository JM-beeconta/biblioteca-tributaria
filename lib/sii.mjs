import { compact, decodeBuffer, extractAnchors, extractDocumentText, extractReferences, fetchResource, inferDate, sha256 } from './utils.mjs';

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
    modernUrl: (year) => `https://www.sii.cl/normativa_legislacion/circulares/${year}/indcir${year}.htm`,
  },
];

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

function extractNumber(text, type, url) {
  const kind = type === 'circular' ? 'Circular' : 'Oficio';
  let m = text.match(new RegExp(`${kind}\\s+(?:Ord(?:inario)?\\.?\\s*)?N[°ºo]?\\s*(\\d{1,6})`, 'i'));
  if (m) return Number(m[1]);
  const file = new URL(url).pathname.split('/').pop() ?? '';
  if (type === 'circular') m = file.match(/circu(?:lar)?[_-]?(\d{1,4})/i);
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
  if (source.type === 'circular') {
    return /circular\s+n?[°ºo]?\s*\d+/i.test(text) || /circu(?:lar)?[_-]?\d+/i.test(url.pathname);
  }
  return /oficio\s+(?:ord(?:inario)?\.?\s*)?n?[°ºo]?\s*\d+/i.test(text)
    || /(?:oficio|of|ord)[_-]?\d+/i.test(url.pathname)
    || /jurisprudencia\/adminis/i.test(url.pathname);
}

function inferSummary(context, type, number) {
  let value = context;
  if (number) {
    const kind = type === 'circular' ? 'Circular' : 'Oficio';
    value = value.replace(new RegExp(`${kind}\\s+(?:Ord(?:inario)?\\.?\\s*)?N[°ºo]?\\s*${number}[^.\\n]*`, 'i'), '');
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
  };
}

function mergeShell(map, key, shell) {
  const existing = map.get(key);
  if (existing) {
    for (const category of shell.categories) existing.categories.add(category);
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
    const hintedDate = inferDate(candidate.context, null);
    const hintedYear = hintedDate ? Number(hintedDate.slice(0, 4)) : year;
    if (allowedYears && hintedYear && !allowedYears.has(hintedYear)) continue;
    const number = extractNumber(`${candidate.label} ${candidate.context}`, source.type, canonical);
    mergeShell(shells, canonical, {
      source: 'SII',
      type: source.type,
      year: hintedYear || year,
      number,
      categories: new Set([source.category]),
      context: candidate.context,
      source_url: canonical,
      index_url: indexUrl,
    });
  }
  return candidates.length;
}

async function fetchIndex(url, log) {
  try {
    const response = await fetchResource(url, { retries: 2, delayMs: 300, timeoutMs: 20000 });
    if (!response) return null;
    return { response, html: decodeBuffer(response.buffer, response.contentType) };
  } catch (error) {
    log(`[SII] Saltando ${url}: ${error.message}`);
    return null;
  }
}

export async function crawlSii({ years, onDocument, log = console.log }) {
  const currentYear = new Date().getFullYear();
  const requestedYears = new Set(years);
  const shells = new Map();

  for (const source of SOURCE_SETS) {
    const sourceYears = years.filter((year) => year >= source.startYear && year <= currentYear);

    if (source.type === 'circular') {
      for (const year of sourceYears) {
        const indexUrl = source.modernUrl(year);
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

  const allShells = [...shells.values()];
  log(`[SII] ${allShells.length} documentos candidatos para ${years.at(-1)}-${years[0]}`);

  await mapWithConcurrency(allShells, 2, async (shell) => {
    log(`[SII] Documento ${shell.type} ${shell.number ?? ''}/${shell.year ?? ''}`);
    let extracted;
    try { extracted = await fetchDocumentText(shell.source_url); }
    catch (error) { log(`[SII] Error documento ${shell.source_url}: ${error.message}`); extracted = null; }

    const extractedText = extracted?.text?.trim() || '';
    const text = extractedText || shell.context || shell.summary || shell.legal || '';
    const date = inferDate(`${shell.date_hint ?? ''}\n${shell.context ?? ''}\n${text.slice(0, 1200)}`, shell.year);
    const actualYear = date ? Number(date.slice(0, 4)) : shell.year;
    if (actualYear && !requestedYears.has(actualYear)) return;

    const number = shell.number ?? extractNumber(text.slice(0, 1600), shell.type, shell.source_url);
    const titlePrefix = shell.type === 'circular' ? 'Circular' : 'Oficio';
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
      content_path: `content/sii/${shell.type === 'circular' ? 'circulares' : 'oficios'}/${actualYear ?? 'sin-fecha'}/${id}.md`,
      blob_id: shell.blob_id ?? null,
    };
    await onDocument(doc, text || 'Documento indexado por metadata oficial del SII; texto completo no disponible en esta ejecución.');
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
