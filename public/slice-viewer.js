// Orthogonal MRI views share the 3D renderer's context and complete segment buffers.
// Coordinates throughout are the same normalized native RAS as the tractography.
(() => {
  'use strict';
  const planes=[
    {name:'Axial',axis:2,right:[1,0,0],up:[0,1,0],labels:['L','R','A','P']},
    {name:'Coronal',axis:1,right:[1,0,0],up:[0,0,1],labels:['L','R','S','I']},
    {name:'Sagittal',axis:0,right:[0,-1,0],up:[0,0,1],labels:['A','P','S','I']}
  ];
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const quadVertex=`#version 300 es
  layout(location=0) in vec2 aPosition;
  out vec2 vPosition;
  void main(){vPosition=aPosition;gl_Position=vec4(aPosition,0,1);}`;
  const imageFragment=`#version 300 es
  precision highp float;precision highp sampler3D;
  in vec2 vPosition;out vec4 color;
  uniform sampler3D uVolume;
  uniform vec3 uCenter,uRight,uUp,uOrigin,uSpacing,uDimensions;
  uniform vec2 uHalfSize;
  uniform float uContrast;
  void main(){
    vec3 p=uCenter+uRight*vPosition.x*uHalfSize.x+uUp*vPosition.y*uHalfSize.y;
    vec3 uv=((p-uOrigin)/uSpacing+vec3(.5))/uDimensions;
    if(any(lessThan(uv,vec3(0)))||any(greaterThan(uv,vec3(1)))){color=vec4(0,0,0,1);return;}
    float value=clamp((texture(uVolume,uv).r-.45)*uContrast+.45,0.,1.);
    color=vec4(vec3(value),1);
  }`;
  const segmentVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec2 aRibbon;
  layout(location=1) in vec3 aStart;layout(location=2) in vec3 aEnd;
  uniform vec3 uCenter,uRight,uUp,uNormal;
  uniform vec2 uHalfSize,uViewport;
  uniform float uSlab;
  out vec3 vDirection;out float vEdge;
  void main(){
    float a=dot(aStart-uCenter,uNormal),b=dot(aEnd-uCenter,uNormal);
    if(min(a,b)>uSlab||max(a,b)<-uSlab){gl_Position=vec4(2,2,2,1);vDirection=vec3(1);vEdge=1.;return;}
    float t0=0.,t1=1.;
    if(abs(b-a)>1.e-10){float lo=(-uSlab-a)/(b-a),hi=(uSlab-a)/(b-a);t0=max(0.,min(lo,hi));t1=min(1.,max(lo,hi));}
    vec3 start=mix(aStart,aEnd,t0)-uCenter,end=mix(aStart,aEnd,t1)-uCenter;
    vec2 p0=vec2(dot(start,uRight),dot(start,uUp))/uHalfSize*uViewport*.5;
    vec2 p1=vec2(dot(end,uRight),dot(end,uUp))/uHalfSize*uViewport*.5;
    vec2 delta=p1-p0;float lengthPx=length(delta);
    vec2 along=lengthPx>1.e-6?delta/lengthPx:vec2(1,0),side=vec2(-along.y,along.x);
    // Crossings perpendicular to a slice remain visible as a small mark.
    vec2 p=(p0+p1)*.5+along*(aRibbon.y-.5)*max(lengthPx,1.4)+side*aRibbon.x*.8;
    gl_Position=vec4(p/uViewport*2.,0,1);vEdge=aRibbon.x;
    vDirection=abs(normalize(aEnd-aStart+vec3(1.e-10)));
  }`;
  const segmentFragment=`#version 300 es
  precision highp float;
  in vec3 vDirection;in float vEdge;out vec4 color;
  uniform vec3 uColor;uniform float uDirection;
  void main(){color=vec4(mix(uColor,normalize(vDirection),uDirection),.7*(1.-.6*abs(vEdge)));}`;
  const crossFragment=`#version 300 es
  precision highp float;
  in vec2 vPosition;out vec4 color;
  uniform vec2 uCursor,uViewport;
  void main(){vec2 d=abs((vPosition-uCursor)*uViewport*.5);if(min(d.x,d.y)>.6||max(d.x,d.y)<4.)discard;color=vec4(.65,.88,.91,.7);}`;
  function create({panel,canvas,gl,requestDraw,getJSON,binary,rgb}){
    const switcher=panel.querySelector('[data-viewer-layouts]');if(!switcher)return null;
    const layoutButtons=[...switcher.querySelectorAll('[data-layout-choice]')];
    const pane=document.createElement('aside');pane.className='slice-pane';pane.hidden=true;pane.setAttribute('aria-label','Linked T1 slices');
    pane.innerHTML=`<div class="slice-heading"><strong>T1 slices</strong><button data-slice-center title="Center crosshair">Center</button></div>
      <p class="slice-status" role="status">Loading matched T1…</p>
      <div class="slice-views">${planes.map(p=>`<section class="slice-card"><div class="slice-title"><strong>${p.name}</strong><output></output></div><div class="slice-image" tabindex="0" role="img" aria-label="${p.name} T1 slice. Click or drag to move crosshair. Scroll or use arrow keys to change slice.">${p.labels.map((label,i)=>`<span class="slice-orientation orientation-${i}">${label}</span>`).join('')}</div><input type="range" min="0" max="1" value="0" step="1" aria-label="${p.name} slice" disabled></section>`).join('')}</div>
      <div class="slice-options"><label class="slice-full-control">Show <select data-slice-content aria-label="2D pathway display"><option value="fibers">Streamlines</option><option value="centroids">Centroids</option></select></label><label class="slice-full-control">Color by <select data-slice-color aria-label="2D pathway coloring"><option value="bundle">Pathway</option><option value="direction">Local orientation</option></select></label><label>Slab <select data-slice-slab aria-label="Pathway slice thickness"><option value="1">1 mm</option><option value="2">2 mm</option><option value="3">3 mm</option></select></label><label>Contrast <input data-slice-contrast aria-label="T1 contrast" type="range" min=".5" max="2.5" value="1" step=".05"></label></div>
      <p class="slice-direction-key" hidden>Red: left–right · Green: anterior–posterior · Blue: superior–inferior</p>
      <p class="slice-help">Click to move crosshair · scroll to change slice</p>`;
    canvas.parentElement.append(pane);
    const status=pane.querySelector('.slice-status'),cards=[...pane.querySelectorAll('.slice-card')];
    let layoutMode='3d',meta=null,cursor=null,promise=null,texture=null,imageProgram,segmentProgram,crossProgram,quadVAO,slab=1,contrast=1;
    panel.dataset.viewerLayout=layoutMode;
    function program(vs,fs,uniforms){
      const p=gl.createProgram();
      for(const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(message)}gl.attachShader(p,s);gl.deleteShader(s)}
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      return {program:p,...Object.fromEntries(uniforms.map(u=>[u,gl.getUniformLocation(p,'u'+u)]))};
    }
    function initialize(){
      if(imageProgram)return;
      const nextImage=program(quadVertex,imageFragment,['Volume','Center','Right','Up','Origin','Spacing','Dimensions','HalfSize','Contrast']);
      const nextSegment=program(segmentVertex,segmentFragment,['Center','Right','Up','Normal','HalfSize','Viewport','Slab','Color','Direction']);
      const nextCross=program(quadVertex,crossFragment,['Cursor','Viewport']);
      imageProgram=nextImage;segmentProgram=nextSegment;crossProgram=nextCross;
      quadVAO=gl.createVertexArray();gl.bindVertexArray(quadVAO);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
    }
    async function load(){
      if(meta||promise)return promise;
      status.textContent='Loading matched T1…';
      promise=(async()=>{
        const source=switcher.dataset.slicesSource,m=await getJSON(source);
        if(m.schemaVersion!==1||m.dataType!=='uint8'||m.storageOrder!=='x-fastest'||m.registrationVerified!==true||
          !m.dimensions?.every(n=>Number.isInteger(n)&&n>1&&n<=gl.getParameter(gl.MAX_3D_TEXTURE_SIZE))||m.dimensions.length!==3||
          !m.displayOrigin?.every(Number.isFinite)||m.displayOrigin.length!==3||!m.displaySpacing?.every(n=>Number.isFinite(n)&&n>0)||m.displaySpacing.length!==3||!m.spacingMm?.every(n=>Number.isFinite(n)&&n>0)||m.spacingMm.length!==3||
          (m.initialVoxel&&(!Array.isArray(m.initialVoxel)||m.initialVoxel.length!==3||!m.initialVoxel.every((n,i)=>Number.isInteger(n)&&n>=0&&n<m.dimensions[i]))))throw new Error('Invalid T1 coordinate mapping');
        const values=await binary(m.data,source,'uint8');if(values.length!==m.dimensions.reduce((a,b)=>a*b,1))throw new Error('Invalid T1 volume');
        initialize();texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
        gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,axis,gl.CLAMP_TO_EDGE);
        gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...m.dimensions,0,gl.RED,gl.UNSIGNED_BYTE,values);
        meta=m;cursor=(m.initialVoxel||m.dimensions.map(n=>Math.floor(n/2))).slice();
        cards.forEach((card,i)=>{const input=card.querySelector('input');input.max=m.dimensions[planes[i].axis]-1;input.disabled=false});
        panel.dataset.sliceState='ready';sync();requestDraw();
      })().catch(error=>{console.warn('T1 slices:',error.message);panel.dataset.sliceState='error';status.textContent='T1 unavailable. Select a 2D view to retry.';promise=null;requestDraw()});
      return promise;
    }
    function sync(){
      if(!meta)return;
      cards.forEach((card,i)=>{const axis=planes[i].axis;card.querySelector('input').value=cursor[axis];card.querySelector('output').textContent=`${cursor[axis]+1} / ${meta.dimensions[axis]}`});
      panel.dataset.sliceVoxel=cursor.join(',');
    }
    function setCursor(next){if(!meta)return;cursor=next.map((v,i)=>Math.max(0,Math.min(meta.dimensions[i]-1,Math.round(v))));sync();requestDraw()}
    function center(){if(meta)setCursor(meta.initialVoxel||meta.dimensions.map(n=>Math.floor(n/2)))}
    function setLayout(value){
      layoutMode=value;const enabled=value!=='3d',full=value==='2d';pane.hidden=!enabled;
      layoutButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.layoutChoice===value)));
      panel.classList.toggle('slices-open',enabled);panel.classList.toggle('slices-full',full);panel.dataset.viewerLayout=value;
      canvas.tabIndex=full?-1:0;canvas.setAttribute('aria-hidden',String(full));
      if(enabled)load();requestDraw();
    }
    layoutButtons.forEach(button=>button.addEventListener('click',()=>setLayout(button.dataset.layoutChoice)));
    pane.querySelector('[data-slice-center]').addEventListener('click',center);
    pane.querySelector('[data-slice-slab]').addEventListener('change',e=>{slab=Number(e.target.value);requestDraw()});
    pane.querySelector('[data-slice-contrast]').addEventListener('input',e=>{contrast=Number(e.target.value);requestDraw()});
    for(const [selector,target] of [['[data-slice-content]','[data-render-mode]'],['[data-slice-color]','[data-color-mode]']]){
      pane.querySelector(selector).addEventListener('change',e=>{const input=panel.querySelector(target);input.value=e.target.value;input.dispatchEvent(new Event('change',{bubbles:true}))});
    }
    function geometry(p,rect){
      const extents=meta.dimensions.map((n,i)=>n*meta.displaySpacing[i]);
      const spanX=Math.abs(dot(extents,p.right)),spanY=Math.abs(dot(extents,p.up));
      const fit=Math.min(rect.width/spanX,rect.height/spanY)*.94;
      const half=[rect.width/fit/2,rect.height/fit/2];
      const center=meta.dimensions.map((n,i)=>meta.displayOrigin[i]+(n-1)*meta.displaySpacing[i]/2);
      center[p.axis]=meta.displayOrigin[p.axis]+cursor[p.axis]*meta.displaySpacing[p.axis];
      return {center,half};
    }
    cards.forEach((card,i)=>{
      const p=planes[i],view=card.querySelector('.slice-image');let dragging=false;
      function move(e){
        if(!meta)return;const rect=view.getBoundingClientRect(),{center,half}=geometry(p,rect);
        const x=((e.clientX-rect.left)/rect.width*2-1)*half[0],y=(1-(e.clientY-rect.top)/rect.height*2)*half[1];
        setCursor(center.map((v,k)=>(v+p.right[k]*x+p.up[k]*y-meta.displayOrigin[k])/meta.displaySpacing[k]));
      }
      view.addEventListener('pointerdown',e=>{if(!meta)return;dragging=true;view.focus({preventScroll:true});view.setPointerCapture(e.pointerId);move(e)});
      view.addEventListener('pointermove',e=>{if(dragging)move(e)});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(event,()=>dragging=false);
      function step(amount){if(meta){const next=cursor.slice();next[p.axis]+=amount;setCursor(next)}}
      view.addEventListener('wheel',e=>{e.preventDefault();step(e.deltaY>0?1:e.deltaY<0?-1:0)},{passive:false});
      view.addEventListener('keydown',e=>{if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();step(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)}});
      card.querySelector('input').addEventListener('input',e=>{if(meta){const next=cursor.slice();next[p.axis]=Number(e.target.value);setCursor(next)}});
    });
    function layout(rect,w,h){
      const top=Math.round((switcher.getBoundingClientRect().bottom-rect.top+10)*h/rect.height);
      if(layoutMode==='3d')return [0,0,w,Math.max(1,h-top)];
      if(layoutMode==='2d')return [0,0,0,0];
      const edge=pane.getBoundingClientRect().right-rect.left,x=Math.min(w-1,Math.round(edge*w/rect.width));
      return [x,0,w-x,Math.max(1,h-top)];
    }
    function render({models,centroids,visible,colors,mode,direction}){
      if(layoutMode==='3d')return;
      const rect=canvas.getBoundingClientRect(),sx=canvas.width/rect.width,sy=canvas.height/rect.height;
      if(meta)status.textContent=`1 mm T1 · ${mode==='centroids'?'centroid':'pathway'} intersections`;
      pane.querySelector('[data-slice-content]').value=mode==='centroids'?'centroids':'fibers';
      pane.querySelector('[data-slice-color]').value=direction?'direction':'bundle';
      pane.querySelector('.slice-direction-key').hidden=layoutMode!=='2d'||!direction;
      gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0,0,Math.round((pane.getBoundingClientRect().right-rect.left)*sx),canvas.height);gl.clearColor(.021,.034,.046,1);gl.clear(gl.COLOR_BUFFER_BIT);
      for(let i=0;meta&&i<planes.length;i++){
        const p=planes[i],view=cards[i].querySelector('.slice-image'),r=view.getBoundingClientRect();if(!r.width||!r.height)continue;
        const x=Math.round((r.left-rect.left)*sx),y=Math.round((rect.bottom-r.bottom)*sy),w=Math.round(r.width*sx),h=Math.round(r.height*sy);
        gl.viewport(x,y,w,h);gl.scissor(x,y,w,h);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
        const {center,half}=geometry(p,r),normal=[0,0,0];normal[p.axis]=1;
        function set(program){gl.useProgram(program.program);gl.uniform3fv(program.Center,center);gl.uniform3fv(program.Right,p.right);gl.uniform3fv(program.Up,p.up);gl.uniform2fv(program.HalfSize,half)}
        gl.disable(gl.BLEND);set(imageProgram);gl.bindVertexArray(quadVAO);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,texture);
        gl.uniform1i(imageProgram.Volume,0);gl.uniform3fv(imageProgram.Origin,meta.displayOrigin);gl.uniform3fv(imageProgram.Spacing,meta.displaySpacing);gl.uniform3fv(imageProgram.Dimensions,meta.dimensions);gl.uniform1f(imageProgram.Contrast,contrast);gl.drawArrays(gl.TRIANGLES,0,6);
        gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);set(segmentProgram);
        gl.uniform3fv(segmentProgram.Normal,normal);gl.uniform2f(segmentProgram.Viewport,w,h);gl.uniform1f(segmentProgram.Slab,slab*meta.displaySpacing[p.axis]/meta.spacingMm[p.axis]/2);gl.uniform1f(segmentProgram.Direction,direction?1:0);
        for(const model of mode==='centroids'?centroids:models.values())if(visible.has(model.id||model.group)){
          gl.bindVertexArray(model.wispVAO);gl.uniform3fv(segmentProgram.Color,rgb(colors[model.id||model.group]));gl.drawArraysInstanced(gl.TRIANGLES,0,6,model.segments);
        }
        const relative=cursor.map((v,k)=>meta.displayOrigin[k]+v*meta.displaySpacing[k]-center[k]),cross=[dot(relative,p.right)/half[0],dot(relative,p.up)/half[1]];
        gl.useProgram(crossProgram.program);gl.bindVertexArray(quadVAO);gl.uniform2fv(crossProgram.Cursor,cross);gl.uniform2f(crossProgram.Viewport,w,h);gl.drawArrays(gl.TRIANGLES,0,6);
      }
      gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.bindVertexArray(null);
    }
    function snapshot(){
      if(layoutMode==='3d'||!meta)return canvas;
      const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
      const context=output.getContext('2d');context.drawImage(canvas,0,0);
      const rect=canvas.getBoundingClientRect(),scale=canvas.width/rect.width;
      context.scale(scale,scale);context.fillStyle='#bed8e0';context.textBaseline='top';
      for(const element of pane.querySelectorAll('.slice-heading strong,.slice-status,.slice-title strong,.slice-title output,.slice-orientation,.slice-direction-key:not([hidden])')){
        const r=element.getBoundingClientRect();context.font=`${element.classList.contains('slice-orientation')?9:10}px sans-serif`;context.fillText(element.textContent,r.left-rect.left,r.top-rect.top);
      }
      const r=pane.querySelector('.slice-options').getBoundingClientRect();context.font='10px sans-serif';context.fillText(`${slab} mm pathway slab · neurological convention`,r.left-rect.left,r.top-rect.top);
      return output;
    }
    return {layout,render,center,snapshot,get isFull(){return layoutMode==='2d'}};
  }
  window.PathwaySlices={create};
})();
