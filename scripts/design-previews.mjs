export function designPreviews({layout,write,resourcesPage,link,url,fs,path,routes}){
 const styles=[['journal','Journal','A compact, type-led research journal. White paper, burgundy links, ruled lists, and no card grid.'],['atlas','Atlas','A visual research index. A side navigation, blue accents, and a prominent figure from the brain-chart study.'],['gallery','Gallery','A dark exhibition page. Large typography, illuminated pathways, and resource links arranged as a catalogue.']];
 const body=`<section class="wrap page-intro"><p class="eyebrow">Style study</p><h1>Three ways to present the same page</h1><p class="lead">Each preview uses the lab’s software, data, and teaching content. Open a version to scroll through it at full size.</p></section><section class="wrap style-options">${styles.map(([id,name,description],i)=>`<article><div class="style-thumbnail"><iframe src="${url('/designs/'+id+'/')}" title="${name} style thumbnail" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><a href="${url('/designs/'+id+'/')}" aria-label="Open ${name} style"></a></div><p class="eyebrow">0${i+1}</p><h2>${name}</h2><p>${description}</p>${link('/designs/'+id+'/','Open '+name+' →','text-link')}</article>`).join('')}</section>`;
 const extra=`<link rel="stylesheet" href="${url('/designs.css')}">`;
 write('/designs/','Style previews','',body,'Three resources-page styles for lab feedback.',extra);
 for(const [id,name] of styles){
   const route='/designs/'+id+'/';
   const bar=`<div class="design-review-bar">${link('/designs/','← Compare styles')}<strong>${name}</strong>${link('/resources/','Current site ↗')}</div>`;
   let html=layout(name+' style','Resources',resourcesPage,route,'Resources-page design preview.',extra);
   html=html.replace('<body class="interior">',`<body class="interior design-${id}">${bar}`).replace(/<meta name="robots" content="[^"]+">/,'<meta name="robots" content="noindex,nofollow">');
   const dest=path.join('dist',route,'index.html');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,html);routes.push(route);
 }
}
