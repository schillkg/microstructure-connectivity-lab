export function viewerPanel(id,expanded,{image,link,url,source='/assets/glass-viewer.json',centroids='/assets/tract-centroids.json',atlasSource}) {
 const choices=[['af','Arcuate','#f3b64f'],['cst','Corticospinal','#49aaff'],['cc','Callosal','#ff4f99']];
 const stage=`<div class="viewer-stage"><canvas id="${id}-canvas" data-source="${url(source)}" ${expanded?`data-centroids="${url(centroids)}"${atlasSource?` data-atlas="${url(atlasSource)}"`:''}`:''} tabindex="0" aria-label="White matter pathways inside the matching brain. Drag or use arrow keys to rotate." role="img"></canvas>${image('/assets/tractography-detail.webp','Reconstructed white matter pathways inside the matching transparent brain','viewer-fallback').replace('<img ','<img data-viewer-fallback hidden ')}<p data-viewer-status role="status">Loading pathways…</p><noscript>${image('/assets/tractography-detail.webp','White matter pathways inside a transparent brain')}</noscript></div>`;
 if(!expanded)return `<div class="tract-viewer inline-viewer" data-tract-viewer>${stage}<div class="viewer-toolbar"><div class="tract-choices" role="group" aria-label="Choose pathways">${[['all','All'],...choices].map(([value,name])=>`<button data-bundle="${value}" aria-pressed="${value==='all'}">${name}</button>`).join('')}</div><div class="viewer-options"><button data-glass aria-pressed="true">Glass brain</button><button data-reset>Reset</button></div></div><div class="viewer-caption viewer-explore"><div><strong>Explore the pathways</strong><span>Rotate the brain, change the rendering, and compare pathways.</span></div>${link('/tractography/','Open full explorer <span aria-hidden="true">↗</span>','button explorer-link')}</div></div>`;
 const segments=(label,target,options,selected)=>`<div class="control-cluster"><span class="control-label">${label}</span><div class="segmented-control" role="group" aria-label="${label}">${options.map(([value,name])=>`<button data-select-target="${target}" data-value="${value}" aria-pressed="${value===selected}">${name}</button>`).join('')}</div></div>`;
 const select=(name,attribute,options,value)=>`<label class="compact-field">${name}<select ${attribute}>${options.map(([v,n])=>`<option value="${v}"${v===value?' selected':''}>${n}</option>`).join('')}</select></label>`;
 const range=(name,attribute,min,max,value,step=1)=>`<label class="compact-field range-field"><span>${name} <output data-readout="${attribute}">${value}${attribute==='data-opacity'?'%':''}</output></span><input ${attribute} type="range" min="${min}" max="${max}" value="${value}" step="${step}" aria-label="${name}"></label>`;
 return `<div class="tract-viewer expanded-viewer" data-tract-viewer data-expanded>
 <div class="viewer-workspace">
 <div class="viewer-main">
 <div class="explorer-controlbar"><div class="explorer-tabs" role="tablist" aria-label="Viewer controls">${['Streamlines','Anatomy','Appearance'].map((name,i)=>`<button role="tab" id="${id}-tab-${i}" aria-controls="${id}-controls-${i}" aria-selected="${i===0}" tabindex="${i===0?'0':'-1'}" data-control-tab="${i}">${name}</button>`).join('')}</div><div class="explorer-utilities"><button data-reset>Reset</button><button data-fullscreen>Full screen</button></div></div>
 <div class="control-deck">
 <section class="control-pane" id="${id}-controls-0" role="tabpanel" aria-labelledby="${id}-tab-0" data-control-pane="0">
 <div class="control-cluster"><span class="control-label">Style</span><div class="segmented-control" role="group" aria-label="Streamline rendering"><button data-fiber-style="solid" aria-pressed="false">Solid tubes</button><button data-fiber-style="wispy" aria-pressed="false">Style 2</button><button data-fiber-style="fine" aria-pressed="true">Style 3</button></div></div>
 ${segments('Show','[data-render-mode]',[['fibers','Streamlines'],['both','+ centroids'],['centroids','Centroids']],'fibers')}
 <select data-render-mode hidden aria-label="Rendering mode"><option value="fibers">Streamlines</option><option value="both">Streamlines + centroids</option><option value="centroids">Centroids</option></select>
 ${select('Color by','data-color-mode',[['bundle','Pathway'],['direction','Local orientation']],'bundle')}
 <p class="orientation-key" data-direction-key hidden>Red: left–right · Green: anterior–posterior · Blue: superior–inferior</p>
 </section>
 <section class="control-pane anatomy-pane" id="${id}-controls-1" role="tabpanel" aria-labelledby="${id}-tab-1" data-control-pane="1" hidden>
 <div data-anatomy-source-field hidden>${segments('Surface','[data-anatomy-source]',[['outline','Brain outline'],['cortex','Cortex']],'outline')}<select data-anatomy-source hidden aria-label="Surface"><option value="outline">Brain outline</option><option value="cortex">Cortical surface</option></select></div>
 ${segments('Surface style','[data-surface-style]',[['glass','Glass'],['wire','Mesh'],['points','Points'],['solid','Solid'],['off','Hide']],'glass')}
 <select data-surface-style hidden aria-label="Surface style"><option value="glass">Glass</option><option value="wire">Fine mesh</option><option value="points">Surface points</option><option value="solid">Solid</option><option value="off">Hidden</option></select>
 ${range('Surface opacity','data-opacity',0,100,16)}
 <div class="cortex-controls" data-cortex-controls hidden>
 ${segments('Hemisphere','[data-hemisphere]',[['all','Both'],['left','Left'],['right','Right']],'all')}<select data-hemisphere hidden aria-label="Hemisphere"><option value="all">Both</option><option value="left">Left</option><option value="right">Right</option></select>
 <label class="parcel-toggle"><input data-parcels type="checkbox">Gray matter regions</label>
 <label class="compact-field region-picker" data-region-field hidden>Region<select data-region><option value="all">All regions</option></select></label>
 <span data-region-key hidden></span></div><p class="viewer-note" data-anatomy-note>The outline follows the matching brain mask.</p>
 </section>
 <section class="control-pane" id="${id}-controls-2" role="tabpanel" aria-labelledby="${id}-tab-2" data-control-pane="2" hidden>
 ${range('Fiber width','data-radius',5,30,12,.5)}<div data-wisp-field>${range('Fiber opacity','data-wisp-opacity',2,65,22)}</div>${range('Lighting','data-light',55,150,110)}${range('Zoom','data-zoom',65,220,122)}
 ${select('Background','data-background',[['dark','Ink'],['light','Ivory']],'dark')}
 </section></div>
 ${stage}
 <div class="camera-toolbar"><div role="group" aria-label="Camera view">${[['oblique','Oblique'],['front','Coronal'],['side','Sagittal'],['top','Axial']].map(([value,name])=>`<button data-view="${value}" aria-pressed="${value==='oblique'}">${name}</button>`).join('')}</div><div><button data-spin aria-pressed="false">Rotate</button><button data-snapshot>Save image</button></div></div>
 </div>
 <aside class="pathway-browser" aria-label="Pathway library"><div class="settings-heading"><h2>Pathways</h2><button data-pathway-selected aria-pressed="false">Selected <span data-selection-count>5</span></button></div>
 <label class="pathway-search" data-pathway-search><span class="sr-only">Find a pathway</span><input type="search" placeholder="Find a pathway or acronym…" data-pathway-filter autocomplete="off"></label>
 <nav class="pathway-system-nav" data-system-nav aria-label="Pathway systems"></nav>
 <div class="pathway-list-heading"><h3 data-system-title>Association</h3><div class="viewer-presets" data-pathway-presets><button data-pathway-start>Start view</button><button data-pathway-clear>Clear</button></div></div>
 <div class="pathway-roster" data-pathway-list role="group" aria-label="Visible pathways and colors"></div>
 <div class="pathway-pagination"><button data-pathway-prev aria-label="Previous pathways">←</button><span data-pathway-page role="status"></span><button data-pathway-next aria-label="Next pathways">→</button></div>
 <p class="viewer-meter" data-load-status role="status" hidden></p>
 <p class="pathway-source">Brainstem groups follow ${link('https://pmc.ncbi.nlm.nih.gov/articles/PMC13277897/','the BundleParc paper ↗')}.</p>
 </aside></div></div>`;
}
