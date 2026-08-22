import { compact, extractAnchors, extractReferences, fetchResource, inferDate, pdfToText, sha256, stripHtml } from './utils.mjs';

const SOURCE_SETS = [
  {
    category: 'Renta',
    type: 'oficio',
    startYear: 1998,
    url: (year) => `https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/${year}/ley_impuesto_renta_jadm${year}.htm`,
  },
  {
    category: 'IVA',
    type: 'oficio',
    startYear: 1998,
    url: (year) => `https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_ventas/${year}/ley_impuesto_ventas_jadm${year}.htm`,
  },
  {
    category: 'Otras Normas',
    type: 'oficio',
    startYear: 1998,
    url: (year) => `https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/otras_normas/${year}/otras_normas_jadm${year}.htm`,
  },
  {
    category: 'Circulares',
    type: 'circular',
    startYear: 1974,
    url: (year) => `https://www.sii.cl/normativa_legislacion/circulares/${year}/indcir${year}.htm`,
  },
];

function extractNumber(text, type, url) {
  const kind = type === 'circular' ? 'Circular' : 'Oficio';
  let m = text.match(new RegExp(`${kind}\\s+(?:Ord\\.?\\s*)?N[°ºo]?\\s*(\\d{1,6})`, 'i'));
  if (m) return Number(m[1]);
  const file = new URL(url).pathname.split('/').pop() ?? '';
  if (type === 'circular') m = file.match(/circu(?:lar)?[_-]?(\d{1,4})/i);
  else m = file.match(/(?:oficio|of|ord)[_-]?(\d{1,6})/i);
  return m ? Number(m[1]) : null;
}

function meaningfulCandidate(anchor, source, year, indexUrl) {
  const url = new URL(anchor.url);
  if (anchor.url === indexUrl) return false;
  if (!/sii\.cl$/i.test(url.hostname)) return false;
  if (/\.(?:css|js|png|jpe?g|gif|svg|ico|zip|xls|xlsx)$/i.test(url.pathname)) return false;
  if (/indice_jadm|jadm\d{4}\.htm$/i.test(url.pathname)) return false;
  const text = `${anchor.label} ${anchor.context}`;
  if (source.type === 'circular') {
    return /circular\s+n?[°ºo]?\s*\d+/i.test(text) || /circu(?:lar)?[_-]?\d+/i.test(url.pathname);
  }
  return /oficio\s+(?:ord\.?\s*)?n?[°ºo]?\s*\d+/i.test(text) || /(?:oficio|of|ord)[_-]?\d+/i.test(url.pathname);
}

function inferSummary(context, type, number) {
  let value = context;
  if (number) {
    const kind = type === 'circular' ? 'Circular' : 'Oficio';
    value = value.replace(new RegExp(`${kind}\\s+(?:Ord\\.?\\s*)?N[°ºo]?\\s*${number}[^.\\n]*`, 'i'), '');
  }
  return compact(value, 520);
}

async function fetchDocumentText(url) {
  const response = await fetchResource(url, { delayMs: 400 });
  if (!response) return null;
  if (/pdf/i.test(response.contentType) || /\.pdf(?:$|\?)/i.test(response.url)) {
    const text = await pdfToText(response.buffer);
    return { text: text.trim(), hash: sha256(response.buffer), finalUrl: response.url, format: 'pdf' };
  }
  const html = response.buffer.toString('utf8');
  return { text: stripHtml(html), hash: sha256(response.buffer), finalUrl: response.url, format: 'html' };
}

export async function crawlSii({ years, onDocument, log = console.log }) {
  const currentYear = new Date().getFullYear();
  const seenUrls = new Map();

  for (const source of SOURCE_SETS) {
    const sourceYears = years.filter((year) => year >= source.startYear && year <= currentYear);
    for (const year of sourceYears) {
      const indexUrl = source.url(year);
      log(`[SII] Índice ${source.category} ${year}`);
      let index;
      try { index = await fetchResource(indexUrl, { retries: 2, delayMs: 300 }); }
      catch (error) { log(`[SII] Saltando ${indexUrl}: ${error.message}`); continue; }
      if (!index) continue;

      const html = index.buffer.toString('utf8');
      const candidates = extractAnchors(html, indexUrl).filter((a) => meaningfulCandidate(a, source, year, indexUrl));

      for (const candidate of candidates) {
        const canonical = candidate.url.split('#')[0];
        const existing = seenUrls.get(canonical);
        if (existing) {
          existing.categories.add(source.category);
          continue;
        }

        const number = extractNumber(`${candidate.label} ${candidate.context}`, source.type, canonical);
        const shell = {
          source: 'SII', type: source.type, year, number,
          categories: new Set([source.category]),
          context: candidate.context,
          source_url: canonical,
        };
        seenUrls.set(canonical, shell);
      }
    }
  }

  for (const shell of seenUrls.values()) {
    log(`[SII] Documento ${shell.type} ${shell.number ?? ''}/${shell.year}`);
    let extracted;
    try { extracted = await fetchDocumentText(shell.source_url); }
    catch (error) { log(`[SII] Error documento ${shell.source_url}: ${error.message}`); continue; }
    if (!extracted) continue;

    const text = extracted.text || shell.context;
    const date = inferDate(`${shell.context}\n${text.slice(0, 1000)}`, shell.year);
    const number = shell.number ?? extractNumber(text.slice(0, 1000), shell.type, extracted.finalUrl);
    const titlePrefix = shell.type === 'circular' ? 'Circular' : 'Oficio';
    const summary = inferSummary(shell.context, shell.type, number) || compact(text, 520);
    const id = `sii-${shell.type}-${shell.year}-${number ?? sha256(extracted.finalUrl).slice(0, 10)}`;
    const doc = {
      id,
      source: 'SII',
      type: shell.type,
      number,
      year: shell.year,
      date,
      title: `${titlePrefix}${number ? ` N° ${number}` : ''} de ${shell.year}`,
      summary,
      categories: [...shell.categories],
      source_url: extracted.finalUrl,
      sha256: extracted.hash,
      format: extracted.format,
      references: extractReferences(text),
      search_text: compact(`${summary} ${text}`, 9000),
      content_path: `content/sii/${shell.type === 'circular' ? 'circulares' : 'oficios'}/${shell.year}/${id}.md`,
    };
    await onDocument(doc, text);
  }
}

export function sourceSetsForTests() {
  return SOURCE_SETS;
}
