(() => {
  'use strict';
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const n=Math.hypot(...a);return a.map(v=>v/n)};
  const defaults={af:'#f3b64f',cst:'#49aaff',cc:'#ff4f99'};
  const rgb=hex=>hex.match(/[a-f\d]{2}/gi).map(h=>parseInt(h,16)/255);
  const geometryCache=new Map();
  async function loadGeometry(source){
    if(!geometryCache.has(source))geometryCache.set(source,(async()=>{
      const response=await fetch(source);if(!response.ok)throw new Error('Geometry unavailable');
      const meta=await response.json();
      const names=[meta.tracts.positions,meta.tracts.offsets,meta.brain.positions,meta.brain.normals,meta.brain.indices];
      const buffers=await Promise.all(names.map(async name=>{const r=await fetch(new URL(name,new URL(source,location.href)));if(!r.ok)throw new Error('Geometry unavailable');return r.arrayBuffer()}));
      return {meta,points:new Float32Array(buffers[0]),offsets:new Uint32Array(buffers[1]),brainPoints:new Float32Array(buffers[2]),brainNormals:new Float32Array(buffers[3]),brainIndices:new Uint16Array(buffers[4])};
    })());
    return geometryCache.get(source);
  }
  const tubeVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aCylinder;
  layout(location=1) in vec3 aStart;
  layout(location=2) in vec3 aEnd;
  uniform mat3 uRotation; uniform vec2 uFit; uniform float uRadius;
  out vec3 vNormal; out vec3 vDirection;
  void main(){
    vec3 axis=normalize(aEnd-aStart);
    vec3 side=normalize(cross(axis,abs(axis.z)<.9?vec3(0,0,1):vec3(0,1,0)));
    vec3 normal=side*aCylinder.x+cross(axis,side)*aCylinder.y;
    vec3 p=uRotation*(mix(aStart,aEnd,aCylinder.z)+normal*uRadius);
    vNormal=uRotation*normal;vDirection=abs(axis);
    gl_Position=vec4(p.xy*uFit,-p.z*.35,1);
  }`;
  const tubeFragment=`#version 300 es
  precision highp float;
  in vec3 vNormal; in vec3 vDirection;
  uniform vec3 uColor; uniform float uDirection; uniform float uBrightness;
  out vec4 color;
  void main(){
    vec3 n=normalize(vNormal),light=normalize(vec3(-.45,.65,1));
    float diffuse=max(0.,dot(n,light));
    float fill=max(0.,dot(n,normalize(vec3(.8,-.4,.4))));
    float specular=pow(max(0.,dot(reflect(-light,n),vec3(0,0,1))),26.);
    vec3 base=mix(uColor,normalize(vDirection),uDirection);
    color=vec4((base*(.27+.7*diffuse+.24*fill)+vec3(.28)*specular)*uBrightness,1);
  }`;
  const brainVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aNormal;
  uniform mat3 uRotation; uniform vec2 uFit; out vec3 vNormal;
  void main(){vec3 p=uRotation*aPosition;vNormal=uRotation*aNormal;gl_Position=vec4(p.xy*uFit,-p.z*.35,1);}`;
  const brainFragment=`#version 300 es
  precision highp float;
  in vec3 vNormal; uniform float uAlpha; uniform float uOpacity; uniform vec3 uColor; out vec4 color;
  void main(){
    vec3 n=normalize(vNormal);float rim=pow(1.-abs(n.z),3.);
    float light=.65+.35*abs(dot(n,normalize(vec3(-.5,.8,1))));
    color=vec4(uColor*light,(uAlpha+.16*rim)*uOpacity);
  }`;
  for(const panel of document.querySelectorAll('[data-tract-viewer]')){
    const $=s=>panel.querySelector(s),$$=s=>[...panel.querySelectorAll(s)];
    const canvas=$('canvas'),status=$('[data-viewer-status]'),fallback=$('[data-viewer-fallback]');
    const expanded=panel.hasAttribute('data-expanded'),choices=$$('[data-bundle]');
    const glass=$('[data-glass]'),modeInput=$('[data-render-mode]');
    let yaw=0,pitch=0,selected='all',showGlass=true,dirty=false,dragging=null,data;
    let models=[],centroids=[],visible=new Set(['af','cst','cc']),colors={...defaults};
    let mode='fibers',direction=false,zoom=1,radius=.00165,opacity=1,brightness=1.05,lightBackground=false;
    let spinning=false,lastFrame=0,currentView='oblique',tube,brain,brainVAO,camera,right,up;
    const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:expanded});
    function fail(message){status.textContent=message;canvas.hidden=true;fallback.hidden=false;panel.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);panel.dataset.viewerState='fallback'}
    if(!gl){fail('Static view · interactive rotation needs WebGL 2.');continue}
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s};
    function program(vs,fs){
      const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      return Object.fromEntries([['program',p],...['Rotation','Fit','Color','Radius','Alpha','Opacity','Direction','Brightness'].map(n=>[n.toLowerCase(),gl.getUniformLocation(p,'u'+n)])]);
    }
    function attribute(index,array,size,stride=0,offset=0,divisor=0){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,stride,offset);gl.vertexAttribDivisor(index,divisor);return b}
    function requestDraw(){if(!dirty){dirty=true;requestAnimationFrame(draw)}}
    function setCamera(name){
      currentView=name;const views={oblique:[[-1.6,2.3,.9],[0,0,1]],front:[[0,1,0],[0,0,1]],side:[[-1,0,0],[0,0,1]],top:[[0,0,1],[0,1,0]]};
      const [d,u]=views[name];camera=unit(d);right=unit(cross(camera.map(v=>-v),u));up=cross(right,camera.map(v=>-v));yaw=0;pitch=0;
      $$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));
    }
    function rotation(){
      const a=yaw*Math.PI/180,b=pitch*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
      const r=right.map((v,i)=>ca*v+sa*camera[i]);
      const u=up.map((v,i)=>cb*v+sb*sa*right[i]-sb*ca*camera[i]);
      const c=camera.map((v,i)=>cb*ca*v-cb*sa*right[i]+sb*up[i]);
      return new Float32Array([r[0],u[0],c[0],r[1],u[1],c[1],r[2],u[2],c[2]]);
    }
    function draw(time=performance.now()){
      dirty=false;if(!data||gl.isContextLost())return;
      if(spinning&&!document.hidden){if(lastFrame)yaw=((yaw+Math.min(time-lastFrame,50)*.009+540)%360)-180;lastFrame=time}else lastFrame=0;
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);
      if(!rect.width||!rect.height)return;
      const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      gl.viewport(0,0,w,h);const bg=lightBackground?[.94,.95,.94]:[8/255,15/255,18/255];gl.clearColor(...bg,1);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
      const fit=.94/data.meta.displayBounds.radius*zoom,rot=rotation();
      const set=p=>{gl.useProgram(p.program);gl.uniformMatrix3fv(p.rotation,false,rot);gl.uniform2f(p.fit,Math.min(w,h)/w*fit,Math.min(w,h)/h*fit)};
      const shell=(face,alpha)=>{set(brain);gl.bindVertexArray(brainVAO);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.enable(gl.CULL_FACE);gl.cullFace(face);gl.uniform1f(brain.alpha,alpha);gl.uniform1f(brain.opacity,opacity);gl.uniform3fv(brain.color,lightBackground?[.22,.4,.45]:[.53,.72,.79]);gl.drawElements(gl.TRIANGLES,data.brainIndices.length,gl.UNSIGNED_SHORT,0)};
      if(showGlass)shell(gl.FRONT,.022);
      gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.depthMask(true);set(tube);gl.uniform1f(tube.brightness,brightness);
      let count=0;
      const show=id=>expanded?visible.has(id):selected==='all'||selected===id;
      if(mode!=='centroids')for(const model of models){
        if(!show(model.id))continue;gl.bindVertexArray(model.vao);gl.uniform3fv(tube.color,rgb(colors[model.id]));gl.uniform1f(tube.radius,radius);gl.uniform1f(tube.direction,direction?1:0);
        gl.drawElementsInstanced(gl.TRIANGLES,36,gl.UNSIGNED_SHORT,0,model.segments);count+=model.streamlines;
      }
      // In combined mode, centroids are a contrasting foreground annotation.
      if(mode==='both'){gl.disable(gl.DEPTH_TEST);gl.depthMask(false)}
      if(mode!=='fibers')for(const model of centroids){
        if(!show(model.group))continue;gl.bindVertexArray(model.vao);gl.uniform3fv(tube.color,mode==='both'?(lightBackground?[.1,.12,.14]:[1,1,.95]):rgb(colors[model.group]));gl.uniform1f(tube.radius,radius*3.5);gl.uniform1f(tube.direction,mode==='both'?0:direction?1:0);gl.drawElementsInstanced(gl.TRIANGLES,36,gl.UNSIGNED_SHORT,0,model.segments);
      }
      gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
      if(showGlass)shell(gl.BACK,.035);
      gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.bindVertexArray(null);
      const help=expanded?'Drag to rotate · scroll to zoom':'Drag to rotate';
      status.textContent=expanded&&visible.size===0?'Choose a pathway to display':help;
      panel.dataset.viewerState='ready';panel.dataset.renderMode=mode;panel.dataset.camera=currentView;panel.dataset.yaw=yaw.toFixed(2);canvas.dataset.streamlines=String(count);
      choices.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bundle===selected)));
      if(glass.type==='checkbox')glass.checked=showGlass;else glass.setAttribute('aria-pressed',String(showGlass));
      if(spinning&&!document.hidden)requestDraw();
    }
    choices.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.bundle;requestDraw()}));
    glass.addEventListener('click',()=>{showGlass=glass.type==='checkbox'?glass.checked:!showGlass;requestDraw()});
    $$('[data-visible]').forEach(el=>el.addEventListener('change',()=>{el.checked?visible.add(el.dataset.visible):visible.delete(el.dataset.visible);requestDraw()}));
    $$('[data-color]').forEach(el=>el.addEventListener('input',()=>{colors[el.dataset.color]=el.value;direction=false;$('[data-color-mode]').value='bundle';$('[data-direction-key]').hidden=true;requestDraw()}));
    modeInput?.addEventListener('change',()=>{mode=modeInput.value;requestDraw()});
    $('[data-color-mode]')?.addEventListener('change',ev=>{direction=ev.target.value==='direction';$('[data-direction-key]').hidden=!direction;requestDraw()});
    function range(selector,assign){$(selector)?.addEventListener('input',ev=>{assign(Number(ev.target.value));requestDraw()})}
    range('[data-opacity]',v=>opacity=v/30);range('[data-radius]',v=>radius=v/10000);range('[data-light]',v=>brightness=v/100);range('[data-zoom]',v=>zoom=v/100);
    $('[data-background]')?.addEventListener('change',ev=>{lightBackground=ev.target.value==='light';panel.classList.toggle('light-view',lightBackground);requestDraw()});
    $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{setCamera(b.dataset.view);requestDraw()}));
    $('[data-spin]')?.addEventListener('click',ev=>{spinning=!spinning;lastFrame=0;ev.currentTarget.setAttribute('aria-pressed',String(spinning));ev.currentTarget.textContent=spinning?'Pause':'Rotate';requestDraw()});
    $('[data-reset]').addEventListener('click',()=>{
      selected='all';visible=new Set(['af','cst','cc']);colors={...defaults};mode='fibers';direction=false;showGlass=true;zoom=1;radius=.00165;opacity=1;brightness=1.05;lightBackground=false;spinning=false;lastFrame=0;setCamera('oblique');panel.classList.remove('light-view');
      $$('[data-visible]').forEach(el=>el.checked=true);$$('[data-color]').forEach(el=>el.value=colors[el.dataset.color]);
      for(const [selector,value] of [['[data-render-mode]','fibers'],['[data-color-mode]','bundle'],['[data-opacity]',30],['[data-radius]',16.5],['[data-light]',105],['[data-zoom]',100],['[data-background]','dark']])if($(selector))$(selector).value=value;
      if($('[data-direction-key]'))$('[data-direction-key]').hidden=true;
      if($('[data-spin]')){$('[data-spin]').setAttribute('aria-pressed','false');$('[data-spin]').textContent='Rotate'}
      requestDraw();
    });
    canvas.addEventListener('pointerdown',ev=>{dragging={x:ev.clientX,y:ev.clientY,yaw,pitch};canvas.setPointerCapture(ev.pointerId);canvas.classList.add('dragging')});
    canvas.addEventListener('pointermove',ev=>{if(!dragging)return;yaw=((dragging.yaw+(ev.clientX-dragging.x)*.4+540)%360)-180;pitch=Math.max(-89,Math.min(89,dragging.pitch+(ev.clientY-dragging.y)*.4));requestDraw()});
    const stop=()=>{dragging=null;canvas.classList.remove('dragging')};
    canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
    canvas.addEventListener('keydown',ev=>{const steps={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]};if(!steps[ev.key])return;ev.preventDefault();yaw=((yaw+steps[ev.key][0]+540)%360)-180;pitch=Math.max(-89,Math.min(89,pitch+steps[ev.key][1]));requestDraw()});
    if(expanded)canvas.addEventListener('wheel',ev=>{ev.preventDefault();zoom=Math.max(.65,Math.min(2.2,zoom*Math.exp(-ev.deltaY*.001)));$('[data-zoom]').value=Math.round(zoom*100);requestDraw()},{passive:false});
    $('[data-snapshot]')?.addEventListener('click',()=>{canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download='white-matter-pathways.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)},'image/png')});
    const full=$('[data-fullscreen]');if(full){if(!document.fullscreenEnabled)full.hidden=true;else full.addEventListener('click',()=>{(document.fullscreenElement?document.exitFullscreen():panel.requestFullscreen()).catch(()=>{});requestDraw()})}
    document.addEventListener('visibilitychange',()=>{lastFrame=0;if(!document.hidden)requestDraw()});
    canvas.addEventListener('webglcontextlost',ev=>{ev.preventDefault();fail('The 3D view was interrupted. Reload to restore rotation.')});
    new ResizeObserver(requestDraw).observe(canvas);
    // A six-sided tube is instanced for every original segment: no streamline sampling.
    function tubeModel(segments){
      const cylinder=[],indices=[];for(let z=0;z<2;z++)for(let i=0;i<6;i++)cylinder.push(Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3),z);
      for(let i=0;i<6;i++){const n=(i+1)%6;indices.push(i,n,i+6,n,n+6,i+6)}
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);attribute(0,new Float32Array(cylinder),3);
      attribute(1,segments,3,24,0,1);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,3,gl.FLOAT,false,24,12);gl.vertexAttribDivisor(2,1);
      const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
      return {vao,segments:segments.length/6};
    }
    loadGeometry(canvas.dataset.source).then(async value=>{
      data=value;setCamera('oblique');tube=program(tubeVertex,tubeFragment);brain=program(brainVertex,brainFragment);
      for(const bundle of data.meta.bundles){
        const segments=new Float32Array((bundle.pointCount-bundle.streamlineCount)*6);let k=0;
        for(let s=0;s<bundle.streamlineCount;s++){
          const begin=data.offsets[bundle.offsetOffset+s],end=data.offsets[bundle.offsetOffset+s+1];
          for(let j=begin;j<end-1;j++){segments.set(data.points.subarray(j*3,j*3+6),k);k+=6}
        }
        models.push({...tubeModel(segments),id:bundle.id,streamlines:bundle.streamlineCount});
      }
      brainVAO=gl.createVertexArray();gl.bindVertexArray(brainVAO);attribute(0,data.brainPoints,3);attribute(1,data.brainNormals,3);
      const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.brainIndices,gl.STATIC_DRAW);gl.bindVertexArray(null);requestDraw();
      if(expanded){
        try{
          const r=await fetch(canvas.dataset.centroids);if(!r.ok)throw new Error('Centroids unavailable');const c=await r.json();
          centroids=c.bundles.map(b=>{const segments=new Float32Array((b.points.length-1)*6);for(let i=0;i<b.points.length-1;i++){segments.set(b.points[i],i*6);segments.set(b.points[i+1],i*6+3)}return {...tubeModel(segments),group:b.group}});
          panel.dataset.centroids=String(centroids.length);requestDraw();
        }catch(error){console.warn(error.message);for(const option of modeInput.options)if(option.value!=='fibers')option.disabled=true;mode='fibers';modeInput.value=mode;requestDraw()}
      }
    }).catch(error=>{console.warn('Pathway viewer:',error.message);fail('Static view · the interactive pathways could not load.')});
  }
})();
