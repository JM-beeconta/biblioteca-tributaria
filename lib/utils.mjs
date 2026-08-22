import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const MONTHS_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function decodeHtmlEntities(value = '') {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    deg: '°', ordm: 'º', aacute: 'á', eacute: 'é', iacute: 'í',
    oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É',
    Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  };
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n] ?? m);
}

export function decodeBuffer(buffer, contentType = '') {
  let charset = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i) ?? [])[1]?.toLowerCase();
  if (!charset) {
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
    charset = (head.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i) ?? [])[1]?.toLowerCase();
  }
  const aliases = {
    'iso-8859-1': 'windows-1252', latin1: 'windows-1252', 'windows-1252': 'windows-1252',
    utf8: 'utf-8', 'utf-8': 'utf-8',
  };
  try {
    return new TextDecoder(aliases[charset] ?? charset ?? 'utf-8').decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

export function stripHtml(html = '') {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractTitle(html = '') {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
}

export function extractAnchors(html = '', baseUrl) {
  const re = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(re)];
  const anchors = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const href = match[2].trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href) || /^mailto:/i.test(href)) continue;
    let url;
    try { url = new URL(href, baseUrl).toString(); } catch { continue; }
    const matchEnd = match.index + match[0].length;
    // En listas tipo "título del anchor seguido de su resumen" (todas las páginas SII que usamos
    // hoy), el texto útil de ESTE ítem va después del anchor; el texto entre el anchor anterior y
    // este siempre es el resumen ajeno del ítem previo, así que el margen hacia atrás se mantiene
    // corto (sólo para capturar algún encabezado suelto) y el límite real es el anchor siguiente.
    const prevEnd = i > 0 ? matches[i - 1].index + matches[i - 1][0].length : 0;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const from = Math.max(0, match.index - 80, prevEnd);
    const to = Math.min(html.length, matchEnd + 900, nextStart);
    anchors.push({
      url,
      label: stripHtml(match[4]),
      context: stripHtml(html.slice(from, to)),
    });
  }
  return anchors;
}

export async function fetchResource(url, { retries = 3, delayMs = 250, timeoutMs = 20000, headers = {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': 'BeecontaBibliotecaTributaria/0.6 (+https://github.com/JM-beeconta/biblioteca-tributaria)',
          accept: 'text/html,application/xhtml+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/plain,*/*;q=0.8',
          ...headers,
        },
      });
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const contentType = response.headers.get('content-type') ?? '';
      const arrayBuffer = await response.arrayBuffer();
      await sleep(delayMs);
      return {
        url: response.url,
        contentType,
        buffer: Buffer.from(arrayBuffer),
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(Math.min(delayMs * attempt * 2, 1500));
    }
  }
  throw lastError;
}

function runTool(command, args, { input = null } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out = [];
    proc.stdout.on('data', (chunk) => out.push(chunk));
    proc.on('error', () => resolve(''));
    proc.on('close', (code) => resolve(code === 0 ? Buffer.concat(out).toString('utf8') : ''));
    if (input) {
      // Si el proceso hijo cierra stdin antes de consumir todo el input (p.ej. un PDF
      // malformado que hace fallar a pdftotext de inmediato), escribir en el pipe ya cerrado
      // lanza un 'error' sin listener y tira abajo TODO el proceso del crawler, no sólo este
      // documento. Sin este handler, un solo documento corrupto puede matar toda la corrida.
      proc.stdin.on('error', () => {});
      proc.stdin.end(input);
    }
  });
}

async function withTempFile(buffer, extension, worker) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beeconta-tax-'));
  const file = path.join(dir, `document${extension}`);
  try {
    await fs.writeFile(file, buffer);
    return await worker(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function pdfToText(buffer) {
  return runTool('pdftotext', ['-layout', '-', '-'], { input: buffer });
}

export async function docToText(buffer) {
  return withTempFile(buffer, '.doc', async (file) => {
    const antiword = await runTool('antiword', [file]);
    if (antiword.trim()) return antiword;
    return runTool('catdoc', [file]);
  });
}

export async function docxToText(buffer) {
  return withTempFile(buffer, '.docx', async (file) => {
    const xml = await runTool('unzip', ['-p', file, 'word/document.xml']);
    if (!xml.trim()) return '';
    return decodeHtmlEntities(xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<[^>]+>/g, ' '))
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
}

export async function rtfToText(buffer) {
  return withTempFile(buffer, '.rtf', async (file) => {
    const output = await runTool('unrtf', ['--text', file]);
    return output.replace(/^###.*$/gm, '').trim();
  });
}

export function detectDocumentFormat({ url = '', contentType = '', buffer = Buffer.alloc(0) } = {}) {
  const cleanType = contentType.toLowerCase();
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return String(url).toLowerCase(); } })();
  const head = buffer.subarray(0, 16);
  const headLatin = head.toString('latin1');

  if (/pdf/.test(cleanType) || /\.pdf$/.test(pathname) || headLatin.startsWith('%PDF-')) return 'pdf';
  if (/wordprocessingml|officedocument/.test(cleanType) || /\.docx$/.test(pathname) || head.subarray(0, 2).toString('latin1') === 'PK') return 'docx';
  if (/msword/.test(cleanType) || /\.doc$/.test(pathname) || head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Array(8).fill(0)]).subarray(0, head.length))) return 'doc';
  if (/rtf/.test(cleanType) || /\.rtf$/.test(pathname) || headLatin.startsWith('{\\rtf')) return 'rtf';
  if (/html|xhtml/.test(cleanType) || /\.html?$/.test(pathname) || /^\s*</.test(buffer.subarray(0, 256).toString('latin1'))) return 'html';
  if (/text\//.test(cleanType) || /\.txt$/.test(pathname)) return 'text';
  return 'unknown';
}

export async function extractDocumentText(resource) {
  const format = detectDocumentFormat(resource);
  let text = '';
  if (format === 'pdf') text = await pdfToText(resource.buffer);
  else if (format === 'doc') text = await docToText(resource.buffer);
  else if (format === 'docx') text = await docxToText(resource.buffer);
  else if (format === 'rtf') text = await rtfToText(resource.buffer);
  else if (format === 'html') text = stripHtml(decodeBuffer(resource.buffer, resource.contentType));
  else if (format === 'text') text = decodeBuffer(resource.buffer, resource.contentType).trim();

  return {
    text: String(text || '').replace(/\u0000/g, '').trim(),
    format,
  };
}

export function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compact(value = '', max = 420) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

export function slug(value = '') {
  return normalizeText(value).replace(/\s+/g, '-').replace(/^-|-$/g, '');
}

export function inferDate(text = '', fallbackYear) {
  let m = text.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:(?:de|del)\s+)?(20\d{2}|19\d{2})/i);
  if (m) {
    const month = MONTHS_ES[normalizeText(m[2])];
    if (month) return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  // Documentos antiguos (índices agregados pre-1994) suelen escribir la fecha sin el conector
  // "de", p.ej. "09 SEPTIEMBRE 1975" en vez de "09 de septiembre de 1975".
  m = text.match(/(\d{1,2})\s+([a-záéíóúñ]+)\s+(20\d{2}|19\d{2})/i);
  if (m) {
    const month = MONTHS_ES[normalizeText(m[2])];
    if (month) return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  m = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2}|19\d{2})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return fallbackYear ? `${fallbackYear}-01-01` : null;
}

export function extractReferences(text = '') {
  const refs = [];
  const seen = new Set();
  const push = (ref) => {
    const key = JSON.stringify(ref);
    if (!seen.has(key)) { seen.add(key); refs.push(ref); }
  };

  for (const m of text.matchAll(/Circular\s+N[°ºo]?\s*(\d{1,4})(?:\s+de|\/|\s*,?\s*del?)\s*(20\d{2}|19\d{2})/gi)) {
    push({ type: 'circular', number: Number(m[1]), year: Number(m[2]) });
  }
  for (const m of text.matchAll(/Oficio\s+N[°ºo]?\s*(\d{1,6})(?:\s+de|\/|\s*,?\s*del?)\s*(20\d{2}|19\d{2})/gi)) {
    push({ type: 'oficio', number: Number(m[1]), year: Number(m[2]) });
  }

  const lawPatterns = [
    { code: 'LIR', names: '(?:Ley sobre Impuesto a la Renta|LIR)' },
    { code: 'LIVS', names: '(?:Ley sobre Impuesto a las Ventas y Servicios|Ley de IVA|LIVS)' },
    { code: 'CT', names: '(?:Código Tributario|Codigo Tributario|CT)' },
  ];
  for (const law of lawPatterns) {
    const re = new RegExp(`art(?:í|i)culo\\s+([0-9]+(?:\\s*(?:bis|ter|quáter|quater|[A-Z]))?(?:\\s+[A-Z])?)[^\\n.;]{0,100}?(?:de\\s+la|del)\\s+${law.names}`, 'gi');
    for (const m of text.matchAll(re)) push({ type: 'articulo', law: law.code, article: m[1].trim() });
  }
  return refs.slice(0, 100);
}

export function markdownDocument(doc, body) {
  const refs = (doc.references ?? []).map((r) => `- ${JSON.stringify(r)}`).join('\n') || '- Sin referencias estructuradas detectadas';
  return `# ${doc.title}\n\n` +
    `- Fuente: ${doc.source}\n` +
    `- Tipo: ${doc.type}\n` +
    `- Número: ${doc.number ?? 'N/A'}\n` +
    `- Año: ${doc.year ?? 'N/A'}\n` +
    `- Fecha: ${doc.date ?? 'N/A'}\n` +
    `- Categoría: ${(doc.categories ?? []).join(', ') || 'N/A'}\n` +
    `- Fuente oficial: ${doc.source_url}\n` +
    `- Hash SHA-256: ${doc.sha256 ?? 'N/A'}\n\n` +
    `## Resumen\n\n${doc.summary || 'Sin resumen.'}\n\n` +
    `## Referencias detectadas\n\n${refs}\n\n` +
    `## Texto extraído\n\n${body.trim()}\n`;
}
