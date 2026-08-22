import { compact, extractReferences, fetchResource, sha256, slug, stripHtml } from './utils.mjs';

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
    articles.push({ number: matches[i][1].trim().replace(/[°º]+$/g, ''), body });
  }
  return articles;
}

export async function crawlBcn({ onDocument, log = console.log }) {
  for (const norm of CORE_NORMS) {
    const sourceUrl = `https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=${norm.idNorma}&idParte=0`;
    log(`[BCN] ${norm.code} (${norm.idNorma})`);
    let response;
    try { response = await fetchResource(sourceUrl, { retries: 3, delayMs: 300 }); }
    catch (error) { log(`[BCN] Error ${norm.code}: ${error.message}`); continue; }
    if (!response) continue;

    const html = response.buffer.toString('utf8');
    const text = stripHtml(html);
    const hash = sha256(response.buffer);
    const year = Number((text.match(/(?:Publicación|Publicacion):?[^\d]*(\d{4})/i) ?? [])[1]) || 1974;
    const version = (text.match(/Versión:\s*([^\n]+)/i) ?? [])[1]?.trim() ?? 'Versión disponible en LeyChile';
    const normId = `bcn-${norm.code.toLowerCase()}`;
    const normDoc = {
      id: normId,
      source: 'BCN',
      type: 'norma',
      number: norm.number,
      year,
      date: null,
      title: norm.title,
      summary: `Texto oficial consolidado en LeyChile. ${version}.`,
      categories: [norm.category],
      source_url: response.url,
      sha256: hash,
      format: 'html',
      references: extractReferences(text),
      search_text: compact(`${norm.title} ${text}`, 9000),
      content_path: `content/bcn/normas/${normId}.md`,
      norm_code: norm.code,
      idNorma: norm.idNorma,
      version,
    };
    await onDocument(normDoc, text);

    for (const article of splitArticles(text)) {
      const articleId = `${normId}-art-${slug(article.number)}`;
      const doc = {
        id: articleId,
        source: 'BCN',
        type: 'articulo',
        number: article.number,
        year,
        date: null,
        title: `Artículo ${article.number} — ${norm.title}`,
        summary: compact(article.body, 520),
        categories: [norm.category],
        source_url: `https://www.bcn.cl/leychile/navegar?idNorma=${norm.idNorma}`,
        sha256: sha256(article.body),
        format: 'text',
        references: extractReferences(article.body),
        search_text: compact(`${norm.title} artículo ${article.number} ${article.body}`, 9000),
        content_path: `content/bcn/articulos/${norm.code.toLowerCase()}/${articleId}.md`,
        norm_code: norm.code,
        idNorma: norm.idNorma,
        article: article.number,
        version,
      };
      await onDocument(doc, article.body);
    }
  }
}

export function splitArticlesForTests(text) {
  return splitArticles(text);
}
