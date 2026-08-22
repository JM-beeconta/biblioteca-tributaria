// Código de cita tipo sello oficial (SII · OF 2111/26, BCN · LIR ART.31) — codifica
// fuente/tipo/número/año en un formato compacto, reutilizado por el navegador (app.js)
// y por la generación de fichas HTML en build-time (scripts/build-site.mjs).
export function citationCode(doc) {
  if (doc.source === 'BCN') {
    const norm = doc.norm_code || 'BCN';
    const version = doc.version_date ? ` · V.${doc.version_date}` : '';
    if (doc.type === 'articulo') return `BCN · ${norm} ART.${doc.article}${version}`;
    return `BCN · ${norm}${version}`;
  }
  const yy = doc.year ? String(doc.year).slice(-2) : '--';
  const kinds = { oficio: 'OF', circular: 'CIR', resolucion: 'RES' };
  const kind = kinds[doc.type] || (doc.type || 'DOC').toUpperCase();
  return `SII · ${kind} ${doc.number ?? '?'}/${yy}`;
}
