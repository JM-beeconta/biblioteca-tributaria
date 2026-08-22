const pageUrl = 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/2026/ley_impuesto_renta_jadm2026.htm';
const listUrl = 'https://www3.sii.cl/getPublicacionesCTByMateria';
const downloadUrl = 'https://www4.sii.cl/gabineteAdmInternet/descargaArchivo';

const page = await fetch(pageUrl, { headers: { 'user-agent': 'BeecontaBibliotecaTributaria/diagnostic' } });
const html = await page.text();

const list = await fetch(listUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json',
    'user-agent': 'BeecontaBibliotecaTributaria/diagnostic',
  },
  body: JSON.stringify({ key: 'RENTA', year: '2026' }),
  signal: AbortSignal.timeout(20000),
});
const rows = await list.json();
const first = rows[0] ?? null;
let download = null;
if (first) {
  const filename = `${first.pubNumOficio}-${first.pubFechaPubli}.pdf`;
  const form = new URLSearchParams({
    nombreDocumento: filename,
    extension: first.extensionArchPublica ?? 'pdf',
    acc: 'download',
    id: String(first.idBlobArchPublica ?? ''),
    mediaType: first.mTypeArchPublica ?? 'application/pdf',
  });
  const response = await fetch(downloadUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'BeecontaBibliotecaTributaria/diagnostic',
    },
    body: form,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  download = {
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentDisposition: response.headers.get('content-disposition'),
    bytes: buffer.length,
    magic: buffer.subarray(0, 12).toString('latin1'),
    filename,
  };
}

console.log(JSON.stringify({
  pageUrl,
  pageStatus: page.status,
  htmlLength: html.length,
  listUrl,
  listStatus: list.status,
  count: Array.isArray(rows) ? rows.length : null,
  first: first ? {
    pubLegal: first.pubLegal,
    tipoArchPublica: first.tipoArchPublica,
    pubNumOficio: first.pubNumOficio,
    pubFechaPubli: first.pubFechaPubli,
    pubResumen: first.pubResumen,
    extensionArchPublica: first.extensionArchPublica,
    idBlobArchPublica: first.idBlobArchPublica,
    mTypeArchPublica: first.mTypeArchPublica,
  } : null,
  downloadUrl,
  download,
}, null, 2));
