import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://jm-beeconta.github.io/biblioteca-tributaria').replace(/\/$/, '');

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst);
    else await fs.copyFile(src, dst);
  }
}

function compactSearchText(doc) {
  const refs = (doc.references ?? []).map((ref) => {
    if (ref.type === 'articulo') return `articulo ${ref.article} ${ref.law}`;
    if (ref.type === 'oficio') return `oficio ${ref.number} ${ref.year}`;
    if (ref.type === 'circular') return `circular ${ref.number} ${ref.year}`;
    return '';
  }).join(' ');
  return [
    doc.title,
    doc.summary,
    ...(doc.categories ?? []),
    doc.norm_code,
    refs,
    String(doc.search_text ?? '').slice(0, 1200),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

await fs.rm(DIST, { recursive: true, force: true });
await copyDir(path.join(ROOT, 'site'), DIST);
await copyDir(path.join(ROOT, 'data'), path.join(DIST, 'data'));
await copyDir(path.join(ROOT, 'content'), path.join(DIST, 'content'));

const index = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'index.json'), 'utf8'));
const catalog = index.map((doc) => ({
  ...doc,
  search_text: compactSearchText(doc),
}));
await fs.writeFile(path.join(DIST, 'data', 'catalog.json'), JSON.stringify(catalog) + '\n', 'utf8');

const meta = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
const llms = `# Biblioteca Tributaria Beeconta\n\nBiblioteca pública de fuentes oficiales tributarias chilenas.\n\n## Fuentes primarias\n- Servicio de Impuestos Internos (SII): Circulares y Jurisprudencia Administrativa / Oficios.\n- Biblioteca del Congreso Nacional (BCN / LeyChile): LIR, LIVS y Código Tributario.\n\n## Acceso para agentes\n1. Catálogo compacto recomendado: ${BASE_URL}/data/catalog.json\n2. Índice técnico completo: ${BASE_URL}/data/index.json\n3. Relaciones detectadas: ${BASE_URL}/data/relations.json\n4. Estado de actualización: ${BASE_URL}/data/meta.json\n5. Cada registro contiene content_path con el texto extraído y source_url con la fuente oficial.\n\nUse catalog.json para descubrir documentos y luego abra content_path sólo para los resultados relevantes.\n\n## Regla de citación\nUsar siempre source_url como fuente jurídica oficial. El contenido local es una copia de consulta y puede contener errores de extracción.\n\nÚltima actualización: ${meta.generated_at}\n`;
await fs.writeFile(path.join(DIST, 'llms.txt'), llms, 'utf8');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${BASE_URL}/</loc></url>\n</urlset>\n`;
await fs.writeFile(path.join(DIST, 'sitemap.xml'), sitemap, 'utf8');
await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`, 'utf8');

console.log(`Sitio construido en ${DIST}`);
console.log(`Catálogo público: ${catalog.length} documentos`);
