const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#primary-nav');
toggle?.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  nav.classList.toggle('open', !expanded);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
    toggle.setAttribute('aria-expanded', 'false');
    nav.classList.remove('open');
    toggle.focus();
  }
});
const search = document.querySelector('#paper-search');
const filters = [...document.querySelectorAll('[data-filter]')];
const papers = [...document.querySelectorAll('[data-paper]')];
const count = document.querySelector('#result-count');
const empty = document.querySelector('#empty-results');
const type = document.querySelector('#paper-type');
const year = document.querySelector('#paper-year');
let topic = new URLSearchParams(location.search).get('topic') || 'All';
if (!filters.some(f => f.dataset.filter === topic)) topic = 'All';
function update() {
  const query = (search?.value || '').trim().toLocaleLowerCase();
  let visible = 0;
  for (const paper of papers) {
    const matches = (topic === 'All' || JSON.parse(paper.dataset.topics).includes(topic)) && paper.dataset.search.includes(query) && (!type || type.value === 'All' || type.value === paper.dataset.type) && (!year || year.value === 'All' || year.value === paper.dataset.year);
    paper.hidden = !matches;
    visible += Number(matches);
  }
  filters.forEach(f => f.setAttribute('aria-pressed', String(f.dataset.filter === topic)));
  if (count) count.textContent = `${visible} ${visible === 1 ? 'publication' : 'publications'}`;
  if (empty) empty.hidden = visible !== 0;
}
filters.forEach(f => f.addEventListener('click', () => { topic = f.dataset.filter; update(); }));
search?.addEventListener('input', update);
if (search) update();
type?.addEventListener('change', update);
year?.addEventListener('change', update);

// Only sends events when a configured analytics provider has loaded.
// Link clicks do not establish that a PDF download completed.
document.querySelectorAll('[data-event="paper_download_click"]').forEach(a => {
  const track = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    if (typeof window.plausible === 'function') window.plausible('paper_download_click', {props: {paper: a.dataset.paperSlug, host: new URL(a.href).hostname}});
  };
  a.addEventListener('click', track);
  a.addEventListener('auxclick', track);
});
