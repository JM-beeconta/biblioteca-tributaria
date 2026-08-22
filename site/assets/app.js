const els = {
  search: document.querySelector('#search'),
  source: document.querySelector('#sourceFilter'),
  type: document.querySelector('#typeFilter'),
  category: document.querySelector('#categoryFilter'),
  year: document.querySelector('#yearFilter'),
  results: document.querySelector('#results'),
  count: document.querySelector('#resultCount'),
  visibleCount: document.querySelector('#visibleCount'),
  resultsActions: document.querySelector('#resultsActions'),
  loadMore: document.querySelector('#loadMore'),
  showAll: document.querySelector('#showAll'),
  updated: document.querySelector('#updatedAt'),
  corpusTotal: document.querySelector('#corpusTotal'),
  corpusBreakdown: document.querySelector('#corpusBreakdown'),
  corpusUpdated: document.querySelector('#corpusUpdated'),
  backfillProgress: document.querySelector('#backfillProgress'),
  backfillText: document.querySelector('#backfillText'),
  reader: document.querySelector('#reader'),
  readerTitle: document.querySelector('#readerTitle'),
  readerBadge: document.querySelector('#readerBadge'),
  readerFrame: document.querySelector('#readerFrame'),
  readerLoading: document.querySelector('#readerLoading'),
  readerOfficial: document.querySelector('#readerOfficial'),
  readerHtml: document.querySelector('#readerHtml'),
  readerClose: document.querySelector('#readerClose'),
};

const PAGE_SIZE = 60;
let docs = [];
let visibleLimit = PAGE_SIZE;

const normalize = (s = '') => s
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\barticulo\b/g, 'art')
  .replace(/\bn[°ºo]\b/g, 'n')
  .replace(/[^a-z0-9ñ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const escapeHtml = (s = '') => s.replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function refLabel(ref) {
  if (ref.type === 'articulo') return `Art. ${ref.article} ${ref.law}`;
  if (ref.type === 'oficio') return `Oficio ${ref.number}/${ref.year}`;
  if (ref.type === 'circular') return `Circular ${ref.number}/${ref.year}`;
  return ref.type;
}

function score(doc, query) {
  if (!query) return 1;
  const q = normalize(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  const title = normalize(doc.title);
  const summary = normalize(doc.summary_short || doc.summary);
  const refs = normalize((doc.references || []).map(refLabel).join(' '));
  const identity = normalize(`${doc.type || ''} ${doc.number || ''} ${doc.year || ''} ${doc.norm_code || ''} ${doc.article || ''} ${doc.version_date || ''}`);
  const haystack = normalize(`${doc.search_text || ''} ${(doc.categories || []).join(' ')} ${doc.norm_code || ''}`);
  let total = 0;

  if (title === q || identity === q || refs === q) total += 30;
  if (title.includes(q)) total += 16;
  if (identity.includes(q)) total += 14;
  if (refs.includes(q)) total += 14;

  for (const token of tokens) {
    let matched = false;
    if (identity.includes(token)) { total += 12; matched = true; }
    if (refs.includes(token)) { total += 10; matched = true; }
    if (title.includes(token)) { total += 8; matched = true; }
    if (summary.includes(token)) { total += 4; matched = true; }
    if (haystack.includes(token)) { total += 1; matched = true; }
    if (!matched) return 0;
  }
  return total;
}

function matchesFilters(doc) {
  if (els.source.value && doc.source !== els.source.value) return false;
  if (els.type.value && doc.type !== els.type.value) return false;
  if (els.category.value && !(doc.categories || []).includes(els.category.value)) return false;
  if (els.year.value && String(doc.year) !== els.year.value) return false;
  return true;
}

function rankedResults() {
  const q = els.search.value.trim();
  return docs
    .filter(matchesFilters)
    .map((doc) => ({ doc, rank: score(doc, q) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || String(b.doc.date || '').localeCompare(String(a.doc.date || '')));
}

function render() {
  const allResults = rankedResults();
  const visibleResults = allResults.slice(0, visibleLimit);
  const total = allResults.length;
  const visible = visibleResults.length;

  els.count.textContent = total.toLocaleString('es-CL');
  els.visibleCount.textContent = total ? `· mostrando ${visible.toLocaleString('es-CL')}` : '';
  els.resultsActions.hidden = visible >= total || total === 0;
  if (!els.resultsActions.hidden) {
    const remaining = total - visible;
    els.loadMore.textContent = `Mostrar ${Math.min(PAGE_SIZE, remaining)} más`;
    els.showAll.textContent = `Mostrar todos (${total.toLocaleString('es-CL')})`;
  }

  if (!total) {
    els.results.innerHTML = '<div class="empty">No encontré coincidencias. Prueba otra palabra o elimina algún filtro.</div>';
    return;
  }

  els.results.innerHTML = visibleResults.map(({ doc }) => {
    const refs = (doc.references || []).slice(0, 6).map((r) => `<span class="ref">${escapeHtml(refLabel(r))}</span>`).join('');
    const meta = [doc.type, doc.year, ...(doc.categories || [])].filter(Boolean).join(' · ');
    const summary = doc.summary_short || doc.summary || 'Documento tributario disponible para consulta.';
    return `<article class="card" data-id="${escapeHtml(doc.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(doc.title)}">
      <div class="card-main">
        <div class="card-meta"><span class="badge ${doc.source === 'SII' ? 'sii' : ''}">${doc.source}</span><span>${escapeHtml(meta)}</span></div>
        <h2>${escapeHtml(doc.title)}</h2>
        <p class="card-summary" title="${escapeHtml(summary)}">${escapeHtml(summary)}</p>
        ${refs ? `<div class="refs">${refs}</div>` : ''}
      </div>
      <div class="card-arrow" aria-hidden="true">→</div>
    </article>`;
  }).join('');

  els.results.querySelectorAll('.card').forEach((card) => {
    const open = () => openReader(docs.find((d) => d.id === card.dataset.id));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

function closeReader() {
  els.reader.close();
  els.readerFrame.src = 'about:blank';
  els.readerLoading.hidden = false;
}

function openReader(doc) {
  if (!doc) return;
  els.readerTitle.textContent = doc.title;
  els.readerBadge.textContent = doc.source;
  els.readerBadge.className = `badge ${doc.source === 'SII' ? 'sii' : ''}`;
  els.readerOfficial.href = doc.source_url;
  const htmlPath = `./${doc.html_path}`;
  els.readerHtml.href = htmlPath;
  els.readerLoading.hidden = false;
  els.readerFrame.onload = () => { els.readerLoading.hidden = true; };
  els.readerFrame.src = htmlPath;
  els.reader.showModal();
}

function populateFilters() {
  const categories = [...new Set(docs.flatMap((d) => d.categories || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const years = [...new Set(docs.map((d) => d.year).filter(Boolean))].sort((a, b) => b - a);
  els.category.innerHTML += categories.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  els.year.innerHTML += years.map((x) => `<option value="${x}">${x}</option>`).join('');
}

function renderCorpusMonitor(meta, backfill) {
  const oficioCount = docs.filter((doc) => doc.source === 'SII' && doc.type === 'oficio').length;
  const circularCount = docs.filter((doc) => doc.source === 'SII' && doc.type === 'circular').length;
  const bcnCount = docs.filter((doc) => doc.source === 'BCN').length;
  els.corpusTotal.textContent = docs.length.toLocaleString('es-CL');
  els.corpusBreakdown.textContent = `Oficios ${oficioCount.toLocaleString('es-CL')} · Circulares ${circularCount.toLocaleString('es-CL')} · BCN ${bcnCount.toLocaleString('es-CL')}`;

  const generated = meta?.generated_at ? new Date(meta.generated_at) : null;
  const updatedLabel = generated && !Number.isNaN(generated.getTime())
    ? generated.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })
    : 'sin fecha';
  els.corpusUpdated.textContent = `Última actualización: ${updatedLabel}`;
  els.updated.textContent = `Actualizado: ${updatedLabel}`;

  if (!backfill) return;
  els.backfillProgress.hidden = false;
  const done = Number(backfill.completed_count || 0);
  const total = Number(backfill.total_ranges || 0);
  if (backfill.status === 'completed') {
    els.backfillProgress.classList.add('completed');
    els.backfillText.textContent = `Histórico completo · ${done}/${total} tramos`;
  } else {
    els.backfillProgress.classList.remove('completed');
    const last = backfill.last_completed_range ? ` · último: ${backfill.last_completed_range}` : '';
    els.backfillText.textContent = `Carga histórica en curso · ${done}/${total} tramos${last}`;
  }
}

async function optionalJson(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? response.json() : null;
  } catch { return null; }
}

async function init() {
  const [catalog, meta, backfill] = await Promise.all([
    fetch('./data/catalog.json', { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`catalog.json ${r.status}`);
      return r.json();
    }),
    optionalJson('./data/meta.json'),
    optionalJson('./data/backfill-status.json'),
  ]);
  docs = catalog;
  populateFilters();
  renderCorpusMonitor(meta, backfill);
  render();
}

[els.search, els.source, els.type, els.category, els.year].forEach((el) => el.addEventListener('input', () => {
  visibleLimit = PAGE_SIZE;
  render();
}));
els.loadMore.addEventListener('click', () => { visibleLimit += PAGE_SIZE; render(); });
els.showAll.addEventListener('click', () => { visibleLimit = Number.MAX_SAFE_INTEGER; render(); });
els.readerClose.addEventListener('click', closeReader);
els.reader.addEventListener('click', (event) => { if (event.target === els.reader) closeReader(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== els.search) { e.preventDefault(); els.search.focus(); }
});

init().catch((error) => {
  console.error(error);
  els.updated.textContent = 'No se pudo cargar la biblioteca.';
  els.corpusUpdated.textContent = 'No se pudo cargar el contador.';
});
