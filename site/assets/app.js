const els = {
  search: document.querySelector('#search'),
  source: document.querySelector('#sourceFilter'),
  type: document.querySelector('#typeFilter'),
  category: document.querySelector('#categoryFilter'),
  year: document.querySelector('#yearFilter'),
  results: document.querySelector('#results'),
  count: document.querySelector('#resultCount'),
  updated: document.querySelector('#updatedAt'),
  reader: document.querySelector('#reader'),
  readerTitle: document.querySelector('#readerTitle'),
  readerBadge: document.querySelector('#readerBadge'),
  readerText: document.querySelector('#readerText'),
  readerOfficial: document.querySelector('#readerOfficial'),
  readerRaw: document.querySelector('#readerRaw'),
  readerClose: document.querySelector('#readerClose'),
};

let docs = [];
const normalize = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escapeHtml = (s = '') => s.replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function refLabel(ref) {
  if (ref.type === 'articulo') return `Art. ${ref.article} ${ref.law}`;
  if (ref.type === 'oficio') return `Oficio ${ref.number}/${ref.year}`;
  if (ref.type === 'circular') return `Circular ${ref.number}/${ref.year}`;
  return ref.type;
}

function score(doc, query) {
  if (!query) return 1;
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const title = normalize(doc.title);
  const summary = normalize(doc.summary);
  const haystack = normalize(`${doc.search_text || ''} ${(doc.categories || []).join(' ')} ${doc.norm_code || ''}`);
  let total = 0;
  for (const token of tokens) {
    if (title.includes(token)) total += 8;
    if (summary.includes(token)) total += 4;
    if (haystack.includes(token)) total += 1;
    else return 0;
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

function render() {
  const q = els.search.value.trim();
  const results = docs
    .filter(matchesFilters)
    .map((doc) => ({ doc, rank: score(doc, q) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || String(b.doc.date || '').localeCompare(String(a.doc.date || '')))
    .slice(0, q ? 120 : 60);

  els.count.textContent = results.length;
  if (!results.length) {
    els.results.innerHTML = '<div class="empty">No encontré coincidencias. Prueba otra palabra o elimina algún filtro.</div>';
    return;
  }

  els.results.innerHTML = results.map(({ doc }) => {
    const refs = (doc.references || []).slice(0, 6).map((r) => `<span class="ref">${escapeHtml(refLabel(r))}</span>`).join('');
    const meta = [doc.type, doc.year, ...(doc.categories || [])].filter(Boolean).join(' · ');
    return `<article class="card" data-id="${escapeHtml(doc.id)}" tabindex="0">
      <div>
        <div class="card-meta"><span class="badge ${doc.source === 'SII' ? 'sii' : ''}">${doc.source}</span><span>${escapeHtml(meta)}</span></div>
        <h2>${escapeHtml(doc.title)}</h2>
        <p>${escapeHtml(doc.summary || '')}</p>
        ${refs ? `<div class="refs">${refs}</div>` : ''}
      </div>
      <div class="card-arrow">→</div>
    </article>`;
  }).join('');

  els.results.querySelectorAll('.card').forEach((card) => {
    const open = () => openReader(docs.find((d) => d.id === card.dataset.id));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

async function openReader(doc) {
  if (!doc) return;
  els.readerTitle.textContent = doc.title;
  els.readerBadge.textContent = doc.source;
  els.readerBadge.className = `badge ${doc.source === 'SII' ? 'sii' : ''}`;
  els.readerOfficial.href = doc.source_url;
  const local = `./${doc.content_path}`;
  els.readerRaw.href = local;
  els.readerText.textContent = 'Cargando texto…';
  els.reader.showModal();
  try {
    const response = await fetch(local);
    els.readerText.textContent = response.ok ? await response.text() : 'No fue posible cargar el texto local.';
  } catch {
    els.readerText.textContent = 'No fue posible cargar el texto local.';
  }
}

function populateFilters() {
  const categories = [...new Set(docs.flatMap((d) => d.categories || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const years = [...new Set(docs.map((d) => d.year).filter(Boolean))].sort((a, b) => b - a);
  els.category.innerHTML += categories.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  els.year.innerHTML += years.map((x) => `<option value="${x}">${x}</option>`).join('');
}

async function init() {
  const [index, meta] = await Promise.all([
    fetch('./data/index.json').then((r) => r.json()),
    fetch('./data/meta.json').then((r) => r.json()),
  ]);
  docs = index;
  populateFilters();
  els.updated.textContent = `Actualizado: ${new Date(meta.generated_at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}`;
  render();
}

[els.search, els.source, els.type, els.category, els.year].forEach((el) => el.addEventListener('input', render));
els.readerClose.addEventListener('click', () => els.reader.close());
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== els.search) { e.preventDefault(); els.search.focus(); }
});

init().catch((error) => {
  console.error(error);
  els.updated.textContent = 'No se pudo cargar la biblioteca.';
});
