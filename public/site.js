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

// Counts interactions only after the owner configures an analytics site tag.
// No names, email addresses, search text, or complete external URLs are sent.
function trackLabEvent(name,props={}) {
  if(typeof window.goatcounter?.count==='function'){
    const labels={paper_download_click:'PDF link',paper_link_click:'Article link',resource_click:'Resource',figure_open:'Figure',news_click:'News',navigation_click:'Navigation',viewer_mode:'Viewer'};
    const item=props.paper||props.resource||props.mode||props.page||props.host||'';
    window.goatcounter.count({path:name+'-'+item,title:(labels[name]||name)+' · '+item.replace(/-/g,' '),event:true,no_session:true});
  }else if(typeof window.plausible==='function')window.plausible(name,{props});
}
function trackLink(event){
  if(event.type==='auxclick'&&event.button!==1)return;
  const a=event.target.closest('a');if(!a)return;
  const destination=new URL(a.href),paper=a.dataset.paperSlug||a.closest('[data-paper-slug]')?.dataset.paperSlug;
  if(a.dataset.event==='paper_download_click')trackLabEvent('paper_download_click',{paper,host:destination.hostname});
  else if(a.closest('[data-resource]'))trackLabEvent('resource_click',{resource:a.closest('[data-resource]').dataset.resource,host:destination.hostname});
  else if(a.closest('.paper-body figure'))trackLabEvent('figure_open',{paper});
  else if(a.closest('.paper-actions')&&paper)trackLabEvent('paper_link_click',{paper,host:destination.hostname});
  else if(a.closest('.news-card'))trackLabEvent('news_click',{host:destination.hostname});
  else if(a.closest('nav'))trackLabEvent('navigation_click',{page:destination.pathname});
}
document.addEventListener('click',trackLink);
document.addEventListener('auxclick',trackLink);
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.matches('[data-render-mode]'))trackLabEvent('viewer_mode',{mode:el.value});
});
