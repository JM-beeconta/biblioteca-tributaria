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

await fs.rm(DIST, { recursive: true, force: true });
await copyDir(path.join(ROOT, 'site'), DIST);
await copyDir(path.join(ROOT, 'data'), path.join(DIST, 'data'));
await copyDir(path.join(ROOT, 'content'), path.join(DIST, 'content'));

const meta = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
const llms = `# Biblioteca Tributaria Beeconta\n\nBiblioteca pública de fuentes oficiales tributarias chilenas.\n\n## Fuentes primarias\n- Servicio de Impuestos Internos (SII): Circulares y Jurisprudencia Administrativa / Oficios.\n- Biblioteca del Congreso Nacional (BCN / LeyChile): LIR, LIVS y Código Tributario.\n\n## Acceso para agentes\n1. Índice estructurado: ${BASE_URL}/data/index.json\n2. Relaciones detectadas: ${BASE_URL}/data/relations.json\n3. Estado de actualización: ${BASE_URL}/data/meta.json\n4. Cada registro de index.json contiene content_path con el texto extraído y source_url con la fuente oficial.\n\n## Regla de citación\nUsar siempre source_url como fuente jurídica oficial. El contenido local es una copia de consulta y puede contener errores de extracción.\n\nÚltima actualización: ${meta.generated_at}\n`;
await fs.writeFile(path.join(DIST, 'llms.txt'), llms, 'utf8');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${BASE_URL}/</loc></url>\n</urlset>\n`;
await fs.writeFile(path.join(DIST, 'sitemap.xml'), sitemap, 'utf8');
await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`, 'utf8');

console.log(`Sitio construido en ${DIST}`);
