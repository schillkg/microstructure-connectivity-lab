(() => {
  'use strict';
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n)};
  const defaults={af:'#f3b64f',cst:'#49aaff',cc:'#ff4f99'};
  const rgb=hex=>/^#[a-f\d]{6}$/i.test(hex)?hex.slice(1).match(/../g).map(h=>parseInt(h,16)/255):[.55,.8,.85];
  const resource=(name,source)=>new URL(name,new URL(source,location.href));
  const typed={float32:Float32Array,uint32:Uint32Array,uint16:Uint16Array,uint8:Uint8Array};
  async function getJSON(source){const r=await fetch(source);if(!r.ok)throw new Error('Geometry unavailable');return r.json()}
  async function binary(name,source,type='float32'){
    const r=await fetch(resource(name,source));if(!r.ok)throw new Error('Geometry unavailable');
    let bytes=await r.arrayBuffer();const signature=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
    // GitHub serves .gz as a file; other hosts may already decode Content-Encoding.
    if(signature[0]===31&&signature[1]===139){
      if(!globalThis.DecompressionStream)throw new Error('This browser cannot unpack compressed geometry');
      bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    const Type=typed[type];if(!Type||bytes.byteLength%Type.BYTES_PER_ELEMENT)throw new Error('Invalid geometry buffer');
    return new Type(bytes);
  }
  async function surfaceData(meta,source){
    const [points,normals,indices,labels,colors]=await Promise.all([
      binary(meta.positions,source),binary(meta.normals,source),binary(meta.indices,source,meta.indicesType||'uint16'),
      meta.labels?binary(meta.labels,source,meta.labelsType||'uint16'):null,
      meta.colors?binary(meta.colors,source,meta.colorsType||'uint8'):null
    ]);
    if(points.length!==normals.length||points.length%3||indices.length%3||(labels&&labels.length!==points.length/3)||(colors&&colors.length!==points.length))throw new Error('Invalid surface geometry');
    return {meta,points,normals,indices,labels,colors};
  }
  const geometryCache=new Map();
  async function loadGeometry(source){
    if(!geometryCache.has(source))geometryCache.set(source,(async()=>{
      const meta=await getJSON(source);
      const [points,offsets,brain]=await Promise.all([
        binary(meta.tracts.positions,source,meta.tracts.positionsType),binary(meta.tracts.offsets,source,meta.tracts.offsetsType),surfaceData(meta.brain,source)
      ]);
      if(points.length!==meta.pointCount*3)throw new Error('Invalid pathway geometry');
      return {meta,points,offsets,brain};
    })());
    return geometryCache.get(source);
  }
  const tubeVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aCylinder; layout(location=1) in vec3 aStart; layout(location=2) in vec3 aEnd;
  uniform mat3 uRotation; uniform vec2 uFit; uniform float uRadius;
  out vec3 vNormal; out vec3 vDirection;
  void main(){
    vec3 axis=normalize(aEnd-aStart+vec3(0,0,1.e-8));
    vec3 side=normalize(cross(axis,abs(axis.z)<.9?vec3(0,0,1):vec3(0,1,0)));
    vec3 normal=side*aCylinder.x+cross(axis,side)*aCylinder.y;
    vec3 p=uRotation*(mix(aStart,aEnd,aCylinder.z)+normal*uRadius);
    vNormal=uRotation*normal;vDirection=abs(axis);gl_Position=vec4(p.xy*uFit,-p.z*.35,1);
  }`;
  const tubeFragment=`#version 300 es
  precision highp float;
  in vec3 vNormal;in vec3 vDirection;
  uniform vec3 uColor;uniform float uDirection;uniform float uBrightness;out vec4 color;
  void main(){
    vec3 n=normalize(vNormal),key=normalize(vec3(-.4,.7,1));
    float diffuse=max(0.,dot(n,key)),fill=max(0.,dot(n,normalize(vec3(.8,-.4,.4))));
    float spec=pow(max(0.,dot(n,normalize(key+vec3(0,0,1)))),48.);
    float rim=pow(1.-abs(n.z),3.);
    vec3 base=mix(uColor,normalize(vDirection),uDirection);
    color=vec4((base*(.21+.68*diffuse+.22*fill)+vec3(.45)*spec+base*.13*rim)*uBrightness,1);
  }`;
  const wispVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec2 aRibbon;layout(location=1) in vec3 aStart;layout(location=2) in vec3 aEnd;
  uniform mat3 uRotation;uniform vec2 uFit;uniform vec2 uViewport;uniform float uRadius;
  out float vEdge;out vec3 vDirection;
  void main(){
    vec3 start=uRotation*aStart,end=uRotation*aEnd;
    vec2 direction=(end.xy-start.xy)*uFit*uViewport;
    vec2 side=normalize(vec2(-direction.y,direction.x)+vec2(1.e-8,0));
    vec3 p=mix(start,end,aRibbon.y);vEdge=aRibbon.x;vDirection=abs(normalize(aEnd-aStart+vec3(0,0,1.e-8)));
    gl_Position=vec4(p.xy*uFit+side*aRibbon.x*uRadius/uViewport*2.,-p.z*.35,1);
  }`;
  const wispFragment=`#version 300 es
  precision highp float;
  in float vEdge;in vec3 vDirection;
  uniform vec3 uColor;uniform float uDirection;uniform float uBrightness;uniform float uOpacity;uniform float uFine;uniform float uPaper;
  out vec4 color;
  void main(){
    float soft=pow(max(0.,1.-abs(vEdge)),1.5);
    // A narrow core and faint halo make Style 3 finer without omitting fibers.
    float fine=.84*exp(-28.*vEdge*vEdge)+.16*exp(-4.5*vEdge*vEdge);
    vec3 base=mix(uColor,normalize(vDirection),uDirection);
    base=mix(base,mix(mix(base,vec3(1.),.22),base*.6,uPaper),uFine);
    color=vec4(base*uBrightness,mix(soft,fine,uFine)*uOpacity);
  }`;
  const surfaceVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aNormal;layout(location=2) in vec3 aColor;layout(location=3) in float aRegion;
  uniform mat3 uRotation;uniform vec2 uFit;uniform float uPointSize;
  out vec3 vNormal;out vec3 vColor;flat out float vRegion;
  void main(){vec3 p=uRotation*aPosition;vNormal=uRotation*aNormal;vColor=aColor;vRegion=aRegion;gl_Position=vec4(p.xy*uFit,-p.z*.35,1);gl_PointSize=uPointSize;}`;
  const surfaceFragment=`#version 300 es
  precision highp float;
  in vec3 vNormal;in vec3 vColor;flat in float vRegion;
  uniform float uAlpha;uniform float uOpacity;uniform vec3 uColor;uniform float uParcels;uniform float uSelected;uniform float uSurfaceStyle;uniform float uInline;
  out vec4 color;
  void main(){
    vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;
    float rim=pow(1.-abs(n.z),2.7),opacity=clamp(uOpacity,0.,1.);
    float key=max(0.,dot(n,normalize(vec3(-.45,.65,1.))));
    float fill=max(0.,dot(n,normalize(vec3(.9,-.4,.28))));
    float backlight=max(0.,dot(n,normalize(vec3(.16,-.72,.67))));
    vec3 base=mix(uColor,vColor,uParcels);
    vec3 lit=base*(.25+.67*key+.2*fill)+vec3(.012,.022,.035)+vec3(.035,.065,.09)*backlight;
    float alpha=opacity;
    // The homepage keeps its faint outline; explorer opacity is a true 0..1 alpha.
    if(uInline>.5)alpha=(uAlpha+.18*rim)*(opacity/.1);
    if(uSurfaceStyle<.5)lit+=vec3(.12,.2,.28)*rim*(1.-opacity);
    if(uSurfaceStyle>1.5&&uSurfaceStyle<2.5)lit*=.76;
    if(uSurfaceStyle>2.5){
      float d=length(gl_PointCoord-vec2(.5))*2.;
      float core=1.-smoothstep(.05,.58,d),halo=.23*(1.-smoothstep(.15,1.,d));
      alpha*=max(core,halo);
      lit=mix(lit,mix(base,vec3(.6,.82,1.),uParcels>.5?.12:.6),.65)+vec3(.08,.13,.18)*core;
    }
    float emphasis=uSelected<0.||abs(vRegion-uSelected)<.5?1.:.08;
    // At full opacity, selection dims context color rather than revealing through it.
    float opaqueContext=uSurfaceStyle<1.5?smoothstep(.75,1.,opacity):0.;
    alpha*=mix(emphasis,1.,opaqueContext);lit*=mix(1.,mix(.28,1.,emphasis),opaqueContext);
    color=vec4(lit,clamp(alpha,0.,1.));
  }`;
  for(const panel of document.querySelectorAll('[data-tract-viewer]')){
    const $=s=>panel.querySelector(s),$$=s=>[...panel.querySelectorAll(s)];
    const canvas=$('canvas'),status=$('[data-viewer-status]'),fallback=$('[data-viewer-fallback]');
    const expanded=panel.hasAttribute('data-expanded'),choices=$$('[data-bundle]'),glass=$('[data-glass]'),modeInput=$('[data-render-mode]');
    const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:expanded?'default':'low-power',preserveDrawingBuffer:expanded});
    let yaw=0,pitch=0,selected='all',dirty=false,dragging=null,data,spinning=false,lastFrame=0,currentView='oblique';
    let mode='fibers',fiberStyle=expanded?'fine':'solid',direction=false,zoom=expanded?1.22:1,radius=expanded?.0012:.00165,opacity=expanded?.16:.1,brightness=1.1,wispOpacity=.22,lightBackground=false;
    let surfaceStyle='glass',anatomySource='outline',hemisphere='all',parcels=false,selectedRegion='all';
    let camera,right,up,tube,wisp,surface,tubeShape,wispShape,tubeIndices,tubeIndexCount;
    let models=new Map(),centroids=[],surfaces=[],atlas=null,atlasURL=null,surfacePromise=null,loading=new Map(),failed=new Set();
    let visible=new Set(['af','cst','cc']),initialVisible=new Set(visible),colors={...defaults},bundleMeta=new Map(),clock=0;
    let activeLoads=0;const loadQueue=[];
    function queuedLoad(task){
      return new Promise((resolve,reject)=>{loadQueue.push({task,resolve,reject});drainLoads()});
    }
    function drainLoads(){
      while(activeLoads<2&&loadQueue.length){const job=loadQueue.shift();activeLoads++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{activeLoads--;drainLoads()})}
    }
    function fail(message){status.textContent=message;canvas.hidden=true;fallback.hidden=false;$$('button,input,select').forEach(el=>el.disabled=true);panel.dataset.viewerState='fallback'}
    if(!gl){fail('Static view · interactive rotation needs WebGL 2.');continue}
    function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
    function program(vs,fs){
      const p=gl.createProgram(),v=shader(gl.VERTEX_SHADER,vs),f=shader(gl.FRAGMENT_SHADER,fs);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      return Object.fromEntries([['program',p],...['Rotation','Fit','Viewport','Color','Radius','Alpha','Opacity','Direction','Brightness','Parcels','Selected','SurfaceStyle','PointSize','Fine','Paper','Inline'].map(n=>[n.toLowerCase(),gl.getUniformLocation(p,'u'+n)])]);
    }
    function buffer(array,target=gl.ARRAY_BUFFER){const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,array,gl.STATIC_DRAW);return b}
    function attribute(index,b,size,{stride=0,offset=0,divisor=0,type=gl.FLOAT,normalized=false}={}){gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,type,normalized,stride,offset);gl.vertexAttribDivisor(index,divisor)}
    function requestDraw(){if(!dirty){dirty=true;requestAnimationFrame(draw)}}
    function setCamera(name){
      currentView=name;const views={oblique:[[-1.6,2.3,.9],[0,0,1]],front:[[0,1,0],[0,0,1]],side:[[-1,0,0],[0,0,1]],top:[[0,0,1],[0,1,0]]};
      const [d,u]=views[name];camera=unit(d);right=unit(cross(camera.map(v=>-v),u));up=cross(right,camera.map(v=>-v));yaw=0;pitch=0;
      $$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));
    }
    function rotation(){
      const a=yaw*Math.PI/180,b=pitch*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
      const r=right.map((v,i)=>ca*v+sa*camera[i]),u=up.map((v,i)=>cb*v+sb*sa*right[i]-sb*ca*camera[i]),c=camera.map((v,i)=>cb*ca*v-cb*sa*right[i]+sb*up[i]);
      return new Float32Array([r[0],u[0],c[0],r[1],u[1],c[1],r[2],u[2],c[2]]);
    }
    const show=id=>expanded?visible.has(id):selected==='all'||selected===id;
    function draw(time=performance.now()){
      dirty=false;if(!data||gl.isContextLost())return;
      if(spinning&&!document.hidden){if(lastFrame)yaw=((yaw+Math.min(time-lastFrame,50)*.009+540)%360)-180;lastFrame=time}else lastFrame=0;
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);if(!rect.width||!rect.height)return;
      const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      gl.viewport(0,0,w,h);gl.clearColor(...(lightBackground?[.95,.952,.935]:[.021,.034,.046]),1);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
      const fit=.94/data.meta.displayBounds.radius*zoom,rot=rotation();
      const set=p=>{gl.useProgram(p.program);gl.uniformMatrix3fv(p.rotation,false,rot);gl.uniform2f(p.fit,Math.min(w,h)/w*fit,Math.min(w,h)/h*fit)};
      const shells=surfaces.filter(s=>s.kind===anatomySource&&(hemisphere==='all'||!s.hemisphere||s.hemisphere===hemisphere));
      const shell=(model,back=false)=>{
        const wire=surfaceStyle==='wire',points=surfaceStyle==='points',solid=surfaceStyle==='solid';
        const showParcels=parcels&&anatomySource==='cortex'&&model.hasRegions,regionSelected=showParcels&&selectedRegion!=='all';
        // Both shaded styles become depth-correct opaque surfaces at 100%.
        const opaque=expanded&&(solid||surfaceStyle==='glass')&&opacity>=.999;
        set(surface);gl.bindVertexArray(model.vao);if(opaque)gl.disable(gl.BLEND);else{gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA)}gl.depthMask(opaque);
        gl.uniform1f(surface.alpha,wire?(model.vertexCount>50000?.055:.16):points?.2:solid?.3:back?.017:.035);
        gl.uniform1f(surface.opacity,opacity);gl.uniform1f(surface.inline,expanded?0:1);gl.uniform1f(surface.parcels,showParcels?1:0);
        // A nonmatching label dims the other hemisphere; outline ignores parcel state.
        gl.uniform1f(surface.selected,regionSelected?(selectedRegion.startsWith(model.id+':')?Number(selectedRegion.slice(model.id.length+1)):1e8):-1);
        gl.uniform1f(surface.surfacestyle,points?3:wire?2:solid?1:0);gl.uniform1f(surface.pointsize,1.8*dpr);
        gl.uniform3fv(surface.color,lightBackground?[.24,.39,.45]:[.47,.7,.84]);
        if(wire){gl.disable(gl.CULL_FACE);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,model.edges);gl.drawElements(gl.LINES,model.edgeCount,model.indexType,0)}
        else if(points){gl.disable(gl.CULL_FACE);gl.drawArrays(gl.POINTS,0,model.vertexCount)}
        else{gl.enable(gl.CULL_FACE);gl.cullFace(back?gl.FRONT:gl.BACK);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,model.indices);gl.drawElements(gl.TRIANGLES,model.indexCount,model.indexType,0)}
      };
      if(opacity>0&&(surfaceStyle==='glass'||surfaceStyle==='solid'))for(const s of shells)shell(s,true);
      gl.disable(gl.CULL_FACE);let count=0;
      if(mode!=='centroids'){
        const wispy=fiberStyle!=='solid',fine=fiberStyle==='fine',p=wispy?wisp:tube;set(p);gl.uniform1f(p.brightness,brightness);gl.uniform1f(p.direction,direction?1:0);
        if(wispy){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.uniform2f(p.viewport,w,h);gl.uniform1f(p.opacity,wispOpacity*(fine?(lightBackground?.45:.35):1));gl.uniform1f(p.fine,fine?1:0);gl.uniform1f(p.paper,lightBackground?1:0);gl.uniform1f(p.radius,Math.max(.3,radius*(fine?350:450))*dpr)}
        else{gl.disable(gl.BLEND);gl.depthMask(true);gl.uniform1f(p.radius,radius)}
        for(const model of models.values())if(show(model.id)){
          gl.bindVertexArray(wispy?model.wispVAO:model.vao);gl.uniform3fv(p.color,rgb(colors[model.id]));
          if(wispy)gl.drawArraysInstanced(gl.TRIANGLES,0,6,model.segments);else gl.drawElementsInstanced(gl.TRIANGLES,tubeIndexCount,gl.UNSIGNED_SHORT,0,model.segments);
          count+=model.streamlines;
        }
      }
      gl.disable(gl.BLEND);gl.depthMask(true);
      if(mode!=='fibers'){
        set(tube);gl.uniform1f(tube.brightness,brightness);gl.uniform1f(tube.radius,radius*3.3);gl.uniform1f(tube.direction,mode==='both'?0:direction?1:0);
        if(mode==='both'){gl.disable(gl.DEPTH_TEST);gl.depthMask(false)}
        for(const c of centroids)if(show(c.group)){gl.bindVertexArray(c.vao);gl.uniform3fv(tube.color,mode==='both'?(lightBackground?[.13,.15,.16]:[1,.97,.85]):rgb(colors[c.group]));gl.drawElementsInstanced(gl.TRIANGLES,tubeIndexCount,gl.UNSIGNED_SHORT,0,c.segments)}
      }
      gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
      if(opacity>0&&surfaceStyle!=='off')for(const s of shells)shell(s);
      gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.bindVertexArray(null);
      status.textContent=expanded&&visible.size===0?'Choose a pathway to display':expanded?'Drag to rotate · scroll to zoom':'Drag to rotate';
      panel.dataset.viewerState='ready';panel.dataset.renderMode=mode;panel.dataset.fiberStyle=fiberStyle;panel.dataset.surfaceStyle=surfaceStyle;panel.dataset.camera=currentView;panel.dataset.yaw=yaw.toFixed(2);panel.dataset.anatomySource=anatomySource;panel.dataset.surfaceOpacity=String(opacity);canvas.dataset.streamlines=String(count);
      choices.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bundle===selected)));
      if(glass)glass.setAttribute('aria-pressed',String(surfaceStyle!=='off'));
      if(spinning&&!document.hidden)requestDraw();
    }
    function shapeGeometry(){
      const cylinder=[],indices=[],sides=8;for(let z=0;z<2;z++)for(let i=0;i<sides;i++)cylinder.push(Math.cos(i*2*Math.PI/sides),Math.sin(i*2*Math.PI/sides),z);
      for(let i=0;i<sides;i++){const n=(i+1)%sides;indices.push(i,n,i+sides,n,n+sides,i+sides)}
      tubeShape=buffer(new Float32Array(cylinder));tubeIndices=buffer(new Uint16Array(indices),gl.ELEMENT_ARRAY_BUFFER);tubeIndexCount=indices.length;
      wispShape=buffer(new Float32Array([-1,0,1,0,-1,1,-1,1,1,0,1,1]));
    }
    // The same segment buffer drives tubes and soft ribbons. No trajectories are sampled out.
    function tubeModel(segments){
      const b=buffer(segments),vao=gl.createVertexArray(),wispVAO=gl.createVertexArray();
      for(const [v,shape,size] of [[vao,tubeShape,3],[wispVAO,wispShape,2]]){
        gl.bindVertexArray(v);attribute(0,shape,size);attribute(1,b,3,{stride:24,divisor:1});attribute(2,b,3,{stride:24,offset:12,divisor:1});if(v===vao)gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,tubeIndices);
      }
      gl.bindVertexArray(null);return {vao,wispVAO,buffer:b,segments:segments.length/6,bytes:segments.byteLength,used:++clock};
    }
    function segmentsFor(points,offsets,meta){
      const start=meta.offsetOffset||0,total=meta.streamlineCount,segments=new Float32Array((meta.pointCount-total)*6);let k=0;
      if(offsets.length<start+total+1)throw new Error('Invalid streamline offsets');
      for(let s=0;s<total;s++){
        const begin=offsets[start+s],end=offsets[start+s+1];if(begin>=end||end>points.length/3)throw new Error('Invalid streamline offsets');
        for(let j=begin;j<end-1;j++){segments.set(points.subarray(j*3,j*3+6),k);k+=6}
      }
      if(k!==segments.length)throw new Error('Invalid streamline point count');return segments;
    }
    function surfaceModel(value,id='outline',kind='outline'){
      const {meta,points,normals,indices,labels}=value,vertexCount=points.length/3,vao=gl.createVertexArray();gl.bindVertexArray(vao);
      attribute(0,buffer(points),3);attribute(1,buffer(normals),3);
      const palette=new Map((meta.regions||[]).map(r=>[Number(r.id),rgb(r.color||'#83b5cd')]));
      let colors=value.colors;if(!colors){colors=new Uint8Array(points.length);for(let i=0;i<vertexCount;i++){const c=palette.get(labels?.[i])||[.47,.7,.84];colors.set(c.map(v=>Math.round(v*255)),i*3)}}
      attribute(2,buffer(colors),3,{type:colors instanceof Uint8Array?gl.UNSIGNED_BYTE:gl.FLOAT,normalized:colors instanceof Uint8Array});
      attribute(3,buffer(labels?Float32Array.from(labels):new Float32Array(vertexCount)),1);
      const indexBuffer=buffer(indices,gl.ELEMENT_ARRAY_BUFFER),Type=indices.constructor,indexType=indices instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT;
      // Unique triangle edges retain the full native mesh resolution without doubled shared edges.
      const edgeSet=new Set(),edges=[];for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3],lo=Math.min(a,b),hi=Math.max(a,b),key=lo*vertexCount+hi;if(!edgeSet.has(key)){edgeSet.add(key);edges.push(lo,hi)}}
      const edgeBuffer=buffer(new Type(edges),gl.ELEMENT_ARRAY_BUFFER);gl.bindVertexArray(null);
      return {id,kind,hemisphere:meta.hemisphere,vao,indices:indexBuffer,edges:edgeBuffer,edgeCount:edges.length,indexCount:indices.length,indexType,vertexCount,hasRegions:!!(labels&&meta.regions?.length)};
    }
    function centroidModel(points,group){
      if(points.length<2)return;const segments=new Float32Array((points.length-1)*6);for(let i=0;i<points.length-1;i++){segments.set(points[i],i*6);segments.set(points[i+1],i*6+3)}
      centroids.push({...tubeModel(segments),group});panel.dataset.centroids=String(centroids.length);
    }
    function reportLoading(){
      const el=$('[data-load-status]');if(!el)return;
      const names=[...loading.keys()].map(id=>bundleMeta.get(id)?.name||'Cortical surface');
      el.hidden=!names.length&&!failed.size;el.textContent=names.length?`Loading ${names.length===1?names[0]:`${names.length} pathways`}…`:failed.size?'A pathway could not load. Toggle it to retry.':'';
    }
    function evictHidden(){
      const hidden=[...models.values()].filter(m=>!visible.has(m.id)&&!initialVisible.has(m.id)).sort((a,b)=>a.used-b.used);
      let bytes=hidden.reduce((n,m)=>n+m.bytes,0);for(const m of hidden){if(bytes<=32*1024*1024)break;gl.deleteVertexArray(m.vao);gl.deleteVertexArray(m.wispVAO);gl.deleteBuffer(m.buffer);models.delete(m.id);bytes-=m.bytes}
    }
    async function ensureBundle(id){
      const meta=bundleMeta.get(id);
      // Manifest centroids can be shown without downloading the full pathway.
      if(meta?.centroid&&!centroids.some(c=>c.group===id))centroidModel(meta.centroid,id);
      if(mode==='centroids')return;
      if(models.has(id)){models.get(id).used=++clock;return}if(loading.has(id))return loading.get(id);
      if(!meta?.positions)return;
      failed.delete(id);const promise=queuedLoad(async()=>{
        if(!visible.has(id)||mode==='centroids')return;
        const [points,offsets]=await Promise.all([binary(meta.positions,atlasURL,meta.positionsType||'float32'),binary(meta.offsets,atlasURL,meta.offsetsType||'uint32')]);
        const model={...tubeModel(segmentsFor(points,offsets,meta)),id,streamlines:meta.streamlineCount};models.set(id,model);
      });loading.set(id,promise);reportLoading();
      try{await promise}catch(error){console.warn('Pathway:',error.message);failed.add(id)}finally{loading.delete(id);reportLoading();evictHidden();requestDraw()}
    }
    function startCortex(){
      anatomySource='cortex';surfaceStyle='points';opacity=.16;
      $('[data-anatomy-source]').value='cortex';$('[data-surface-style]').value='points';$('[data-opacity]').value=16;$('[data-cortex-controls]').hidden=false;ensureCortex();syncControls();
    }
    async function ensureCortex(){
      if(surfacePromise){if(surfaces.some(s=>s.kind==='cortex'))$('[data-anatomy-note]').textContent=atlas.surfaceDescription||'Matched cortical surfaces in the same coordinate frame as the pathways.';return surfacePromise}if(!atlas?.surfaces?.length)return;
      const note=$('[data-anatomy-note]');note.textContent='Loading cortical surfaces…';
      surfacePromise=(async()=>{const values=[];for(const m of atlas.surfaces)values.push(await surfaceData(m,atlasURL));surfaces.push(...values.map((value,i)=>surfaceModel(value,atlas.surfaces[i].id,'cortex')));if(anatomySource==='cortex')note.textContent=atlas.surfaceDescription||'Matched cortical surfaces in the same coordinate frame as the pathways.';requestDraw()})().catch(error=>{surfacePromise=null;anatomySource='outline';$('[data-anatomy-source]').value='outline';$('[data-cortex-controls]').hidden=true;note.textContent='The cortical surface could not load. The matching brain outline is still available.';console.warn('Cortex:',error.message);syncControls();requestDraw()});
      return surfacePromise;
    }
    const classification=JSON.parse(document.querySelector('#pathway-group-data')?.textContent||'{}');
    const systemDefs=[...['Association','Projection','Commissural'].map(name=>({id:name,name,displayName:name})),...(classification.groups||[])];
    let activeSystem='Association',selectedOnly=false,pathwayPage=0,pathwayPageSize=4,query='';
    function systemFor(meta){return classification.mappings?.[meta.generator]?.[meta.sourceName]||(meta.group==='Brainstem'?'cerebellar-peduncular':meta.group)||'Association'}
    function familyFor(meta){return meta.name.replace(/ · (left|right)/g,'').replace(/ · BrainstemSeg/g,'').replace(/ \(sparse\)/g,'')}
    function syncControls(){
      $$('[data-select-target]').forEach(b=>b.setAttribute('aria-pressed',String($(b.dataset.selectTarget)?.value===b.dataset.value)));
      $$('[data-readout]').forEach(o=>{const input=$('['+o.dataset.readout+']');if(input)o.textContent=input.value+(o.dataset.readout==='data-opacity'?'%':'')});
    }
    function renderSystems(){
      const nav=$('[data-system-nav]');if(!nav)return;const focusedSystem=document.activeElement?.dataset.system;nav.replaceChildren();
      for(const brainstem of [false,true]){
        if(brainstem){const label=document.createElement('span');label.className='system-family-label';label.textContent='Brainstem & subcortical';nav.append(label)}
        const row=document.createElement('div');row.className='system-family'+(brainstem?' brainstem-systems':'');
        for(const def of systemDefs.filter(d=>(!!d.table||d.section==='brainstem')===brainstem)){
          const members=[...bundleMeta.values()].filter(m=>systemFor(m)===def.id),count=members.filter(m=>visible.has(m.id)).length;
          const b=document.createElement('button');b.dataset.system=def.id;b.title=def.name;b.setAttribute('aria-pressed',String(!query&&!selectedOnly&&activeSystem===def.id));
          const name=document.createElement('span'),badge=document.createElement('span');name.textContent=def.displayName;badge.textContent=count?String(count):'';badge.setAttribute('aria-hidden','true');b.append(name,badge);b.disabled=!members.length;row.append(b);
        }nav.append(row);
      }
      $('[data-selection-count]').textContent=String(visible.size);$('[data-pathway-selected]').setAttribute('aria-pressed',String(selectedOnly));
      if(focusedSystem)$$('[data-system]').find(b=>b.dataset.system===focusedSystem)?.focus({preventScroll:true});
      panel.dataset.pathwayCount=String(bundleMeta.size);panel.dataset.selectedPathways=String(visible.size);
    }
    function renderBundleList(){
      const list=$('[data-pathway-list]');if(!list)return;
      const oldFocus=document.activeElement?.dataset.visible;
      const families=new Map();
      for(const meta of bundleMeta.values()){
        if(query?![meta.name,meta.sourceName,meta.id].filter(Boolean).join(' ').toLowerCase().includes(query):selectedOnly?!visible.has(meta.id):systemFor(meta)!==activeSystem)continue;
        const key=systemFor(meta)+'|'+(meta.generator||'original')+'|'+familyFor(meta);if(!families.has(key))families.set(key,[]);families.get(key).push(meta);
      }
      const all=[...families.values()],pages=Math.max(1,Math.ceil(all.length/pathwayPageSize));pathwayPage=Math.min(pathwayPage,pages-1);list.replaceChildren();
      const start=pathwayPage*pathwayPageSize;
      for(const members of all.slice(start,start+pathwayPageSize)){
        const row=document.createElement('div');row.className='pathway-family';
        const name=document.createElement('div');name.className='pathway-family-name';
        const title=document.createElement('span');title.textContent=familyFor(members[0]);title.title=title.textContent;name.append(title);
        const acronym=document.createElement('small');acronym.textContent=(members[0].generator?members[0].generator+' · ':'')+(members[0].sourceName||members[0].id.replace(/^ts-/,'')).replace(/[_-](left|right|L|R)$/i,'').replace(/_/g,' ');name.append(acronym);row.append(name);
        const choices=document.createElement('div');choices.className='pathway-family-options';
        for(const meta of members){
          const side=document.createElement('div');side.className='pathway-side';side.style.setProperty('--pathway-color',colors[meta.id]);
          const label=document.createElement('label'),check=document.createElement('input'),caption=document.createElement('span');
          check.type='checkbox';check.dataset.visible=meta.id;check.checked=visible.has(meta.id);check.setAttribute('aria-label',meta.name);
          const hemi=meta.hemisphere||(/ · (left|right)/.exec(meta.name)||[])[1];caption.textContent=hemi==='left'?'L':hemi==='right'?'R':'On';
          if(meta.name.includes('(sparse)')){caption.textContent+='*';label.classList.add('sparse-pathway')}label.title=meta.name+(meta.name.includes('(sparse)')?' · '+meta.streamlineCount+' streamlines':'');label.append(check,caption);side.append(label);
          const color=document.createElement('input');color.type='color';color.dataset.color=meta.id;color.value=colors[meta.id];color.title='Change '+meta.name+' color';color.setAttribute('aria-label',meta.name+' color');side.append(color);choices.append(side);
        }row.append(choices);list.append(row);
      }
      if(all.slice(start,start+pathwayPageSize).some(members=>members.some(m=>m.name.includes('(sparse)')))){const note=document.createElement('p');note.className='sparse-note';note.textContent='* Sparse reconstruction (fewer than 100 streamlines).';list.append(note)}
      if(!all.length){const empty=document.createElement('p');empty.className='pathway-empty';empty.textContent=query?'No pathways match this search.':selectedOnly?'Choose a system to add pathways.':'Pathways are loading…';list.append(empty)}
      $('[data-system-title]').textContent=query?'Search results':selectedOnly?'Selected pathways':systemDefs.find(d=>d.id===activeSystem)?.displayName||activeSystem;
      $('[data-pathway-page]').textContent=all.length?`${start+1}–${Math.min(start+pathwayPageSize,all.length)} of ${all.length} pathways`:'';
      $('[data-pathway-prev]').disabled=pathwayPage===0;$('[data-pathway-next]').disabled=pathwayPage===pages-1;
      renderSystems();
      if(oldFocus){const control=$$('[data-visible]').find(el=>el.dataset.visible===oldFocus);control?.focus({preventScroll:true})}
    }
    function updateGroupCounts(){renderSystems();if(selectedOnly)renderBundleList()}
    function clearPathwaySearch(){query='';pathwayPage=0;if($('[data-pathway-filter]'))$('[data-pathway-filter]').value=''}
    $('[data-system-nav]')?.addEventListener('click',ev=>{const b=ev.target.closest('[data-system]');if(!b)return;activeSystem=b.dataset.system;selectedOnly=false;clearPathwaySearch();renderBundleList()});
    $('[data-pathway-selected]')?.addEventListener('click',()=>{selectedOnly=!selectedOnly;clearPathwaySearch();renderBundleList()});
    $('[data-pathway-prev]')?.addEventListener('click',()=>{pathwayPage--;renderBundleList()});
    $('[data-pathway-next]')?.addEventListener('click',()=>{pathwayPage++;renderBundleList()});
    if(expanded)new ResizeObserver(entries=>{const size=Math.max(1,Math.min(10,Math.floor((entries[0].contentRect.height-24)/64)));if(size!==pathwayPageSize){pathwayPageSize=size;pathwayPage=0;renderBundleList()}}).observe($('[data-pathway-list]'));
    function showControlTab(index,focus=false){
      $$('[data-control-tab]').forEach(b=>{const on=b.dataset.controlTab===String(index);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;if(on&&focus)b.focus()});
      $$('[data-control-pane]').forEach(p=>p.hidden=p.dataset.controlPane!==String(index));
    }
    $$('[data-control-tab]').forEach(b=>{b.addEventListener('click',()=>showControlTab(b.dataset.controlTab));b.addEventListener('keydown',ev=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(ev.key))return;ev.preventDefault();showControlTab(ev.key==='Home'?0:ev.key==='End'?2:(Number(b.dataset.controlTab)+(ev.key==='ArrowRight'?1:2))%3,true)})});
    $$('[data-select-target]').forEach(b=>b.addEventListener('click',()=>{const input=$(b.dataset.selectTarget);input.value=b.dataset.value;input.dispatchEvent(new Event('change',{bubbles:true}));syncControls()}));
    function updateStyle(){
      $$('[data-fiber-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fiberStyle===fiberStyle)));
      if($('[data-wisp-field]'))$('[data-wisp-field]').hidden=fiberStyle==='solid'||mode==='centroids';
      syncControls();requestDraw();
    }
    choices.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.bundle;requestDraw()}));
    glass?.addEventListener('click',()=>{surfaceStyle=surfaceStyle==='off'?'glass':'off';requestDraw()});
    $('[data-pathway-list]')?.addEventListener('change',ev=>{const el=ev.target;if(!el.matches('[data-visible]'))return;el.checked?visible.add(el.dataset.visible):visible.delete(el.dataset.visible);if(el.checked)ensureBundle(el.dataset.visible);updateGroupCounts();evictHidden();requestDraw()});
    $('[data-pathway-list]')?.addEventListener('input',ev=>{const el=ev.target;if(!el.matches('[data-color]'))return;colors[el.dataset.color]=el.value;el.closest('.pathway-side').style.setProperty('--pathway-color',el.value);direction=false;$('[data-color-mode]').value='bundle';$('[data-direction-key]').hidden=true;requestDraw()});
    $('[data-pathway-filter]')?.addEventListener('input',ev=>{query=ev.target.value.trim().toLowerCase();pathwayPage=0;renderBundleList()});
    function selectStart(clear=false){visible=new Set(clear?[]:initialVisible);if(!clear){selectedOnly=true;clearPathwaySearch()}renderBundleList();evictHidden();requestDraw()}
    $('[data-pathway-start]')?.addEventListener('click',()=>selectStart());$('[data-pathway-clear]')?.addEventListener('click',()=>selectStart(true));
    $$('[data-fiber-style]').forEach(b=>b.addEventListener('click',()=>{fiberStyle=b.dataset.fiberStyle;updateStyle()}));
    modeInput?.addEventListener('change',()=>{mode=modeInput.value;for(const id of visible)ensureBundle(id);updateStyle()});
    $('[data-color-mode]')?.addEventListener('change',ev=>{direction=ev.target.value==='direction';$('[data-direction-key]').hidden=!direction;requestDraw()});
    function range(selector,assign){$(selector)?.addEventListener('input',ev=>{assign(Number(ev.target.value));syncControls();requestDraw()})}
    range('[data-opacity]',v=>opacity=Math.max(0,Math.min(1,v/100)));range('[data-radius]',v=>radius=v/10000);range('[data-light]',v=>brightness=v/100);range('[data-zoom]',v=>zoom=v/100);range('[data-wisp-opacity]',v=>wispOpacity=v/100);
    $('[data-surface-style]')?.addEventListener('change',ev=>{surfaceStyle=ev.target.value;if(surfaceStyle==='solid'){opacity=1;$('[data-opacity]').value=100}else if(surfaceStyle==='glass'&&opacity===1){opacity=.12;$('[data-opacity]').value=12}syncControls();requestDraw()});
    $('[data-anatomy-source]')?.addEventListener('change',ev=>{anatomySource=ev.target.value;$('[data-cortex-controls]').hidden=anatomySource!=='cortex';if(anatomySource==='cortex')ensureCortex();else $('[data-anatomy-note]').textContent='The outline follows the matching brain mask.';requestDraw()});
    $('[data-hemisphere]')?.addEventListener('change',ev=>{hemisphere=ev.target.value;requestDraw()});
    $('[data-parcels]')?.addEventListener('change',ev=>{parcels=ev.target.checked;$('[data-region-field]').hidden=!parcels;$('[data-region-key]').hidden=!parcels;requestDraw()});
    $('[data-region]')?.addEventListener('change',ev=>{selectedRegion=ev.target.value;$('[data-region-key]').textContent=ev.target.selectedOptions[0].textContent;requestDraw()});
    $('[data-background]')?.addEventListener('change',ev=>{lightBackground=ev.target.value==='light';panel.classList.toggle('light-view',lightBackground);requestDraw()});
    $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{setCamera(b.dataset.view);requestDraw()}));
    $('[data-spin]')?.addEventListener('click',ev=>{spinning=!spinning;lastFrame=0;ev.currentTarget.setAttribute('aria-pressed',String(spinning));ev.currentTarget.textContent=spinning?'Pause':'Rotate';requestDraw()});
    $('[data-reset]').addEventListener('click',()=>{
      selected='all';visible=new Set(initialVisible);for(const [id,meta] of bundleMeta)colors[id]=meta.color||defaults[id]||'#83b5cd';mode='fibers';fiberStyle=expanded?'fine':'solid';direction=false;surfaceStyle='glass';anatomySource='outline';hemisphere='all';parcels=false;selectedRegion='all';zoom=expanded?1.22:1;radius=expanded?.0012:.00165;opacity=expanded?.16:.1;brightness=1.1;wispOpacity=.22;lightBackground=false;spinning=false;lastFrame=0;setCamera('oblique');panel.classList.remove('light-view');
      $$('[data-visible]').forEach(el=>el.checked=visible.has(el.dataset.visible));$$('[data-color]').forEach(el=>el.value=colors[el.dataset.color]);
      for(const [selector,value] of [['[data-render-mode]','fibers'],['[data-color-mode]','bundle'],['[data-opacity]',16],['[data-radius]',expanded?12:16.5],['[data-light]',110],['[data-zoom]',expanded?122:100],['[data-background]','dark'],['[data-surface-style]','glass'],['[data-anatomy-source]','outline'],['[data-hemisphere]','all'],['[data-region]','all'],['[data-wisp-opacity]',22]])if($(selector))$(selector).value=value;
      for(const selector of ['[data-direction-key]','[data-cortex-controls]','[data-region-field]','[data-region-key]'])if($(selector))$(selector).hidden=true;
      if($('[data-parcels]'))$('[data-parcels]').checked=false;if($('[data-anatomy-note]'))$('[data-anatomy-note]').textContent='The outline follows the matching brain mask.';
      clearPathwaySearch();selectedOnly=false;activeSystem='Association';renderBundleList();if(expanded&&atlas?.surfaces?.length)startCortex();syncControls();
      if($('[data-spin]')){$('[data-spin]').setAttribute('aria-pressed','false');$('[data-spin]').textContent='Rotate'}evictHidden();updateStyle();
    });
    canvas.addEventListener('pointerdown',ev=>{dragging={x:ev.clientX,y:ev.clientY,yaw,pitch};canvas.setPointerCapture(ev.pointerId);canvas.classList.add('dragging')});
    canvas.addEventListener('pointermove',ev=>{if(!dragging)return;yaw=((dragging.yaw+(ev.clientX-dragging.x)*.4+540)%360)-180;pitch=Math.max(-89,Math.min(89,dragging.pitch+(ev.clientY-dragging.y)*.4));requestDraw()});
    const stop=()=>{dragging=null;canvas.classList.remove('dragging')};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
    canvas.addEventListener('keydown',ev=>{const steps={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]};if(!steps[ev.key])return;ev.preventDefault();yaw=((yaw+steps[ev.key][0]+540)%360)-180;pitch=Math.max(-89,Math.min(89,pitch+steps[ev.key][1]));requestDraw()});
    if(expanded)canvas.addEventListener('wheel',ev=>{ev.preventDefault();zoom=Math.max(.65,Math.min(2.2,zoom*Math.exp(-ev.deltaY*.001)));$('[data-zoom]').value=Math.round(zoom*100);syncControls();requestDraw()},{passive:false});
    $('[data-snapshot]')?.addEventListener('click',()=>{requestDraw();requestAnimationFrame(()=>canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download='white-matter-pathways.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)},'image/png'))});
    const full=$('[data-fullscreen]');if(full){if(!document.fullscreenEnabled)full.hidden=true;else full.addEventListener('click',()=>{(document.fullscreenElement?document.exitFullscreen():panel.requestFullscreen()).catch(()=>{});requestDraw()})}
    document.addEventListener('visibilitychange',()=>{lastFrame=0;if(!document.hidden)requestDraw()});
    canvas.addEventListener('webglcontextlost',ev=>{ev.preventDefault();fail('The 3D view was interrupted. Reload to restore rotation.')});new ResizeObserver(requestDraw).observe(canvas);
    loadGeometry(canvas.dataset.source).then(async value=>{
      data=value;setCamera('oblique');tube=program(tubeVertex,tubeFragment);wisp=program(wispVertex,wispFragment);surface=program(surfaceVertex,surfaceFragment);shapeGeometry();
      const initialBundles=data.meta.bundles.flatMap(b=>expanded&&b.parts?.length?b.parts:[b]);
      for(const meta of initialBundles){bundleMeta.set(meta.id,meta);colors[meta.id]=meta.color||defaults[meta.id]||'#83b5cd';models.set(meta.id,{...tubeModel(segmentsFor(data.points,data.offsets,meta)),id:meta.id,streamlines:meta.streamlineCount})}
      visible=new Set(initialBundles.map(b=>b.id));initialVisible=new Set(visible);surfaces.push(surfaceModel(data.brain));renderBundleList();requestDraw();
      if(!expanded)return;
      try{const c=await getJSON(canvas.dataset.centroids);for(const b of c.bundles)centroidModel(b.points,bundleMeta.has(b.id)?b.id:b.group);requestDraw()}catch(error){console.warn('Centroids:',error.message)}
      if(canvas.dataset.atlas){
        try{
          atlasURL=canvas.dataset.atlas;const candidate=await getJSON(atlasURL);if(candidate.registrationVerified!==true)throw new Error('Anatomy registration has not been verified');atlas=candidate;
          for(const meta of atlas.bundles||[]){if(bundleMeta.has(meta.id))throw new Error('Duplicate pathway identifier');bundleMeta.set(meta.id,meta);colors[meta.id]=meta.color||'#83b5cd'}
          renderBundleList();
          if(atlas.surfaces?.length){
            $('[data-anatomy-source-field]').hidden=false;const regionSelect=$('[data-region]');let hasRegions=false;
            for(const s of atlas.surfaces)for(const r of s.regions||[]){hasRegions=true;const option=document.createElement('option');option.value=s.id+':'+r.id;option.textContent=(s.hemisphere?s.hemisphere==='left'?'Left · ':'Right · ':'')+r.name;regionSelect.append(option)}
             $('[data-parcels]').disabled=!hasRegions;$('[data-region-key]').textContent=atlas.atlasName||'Regions follow the cortical parcellation.';startCortex();
          }
        }catch(error){console.warn('Additional anatomy:',error.message);const note=$('[data-load-status]');note.hidden=false;note.textContent='Additional anatomy is unavailable. The original pathways remain available.'}
      }
      if(!centroids.length&&!atlas?.bundles?.some(b=>b.centroid)){for(const option of modeInput.options)if(option.value!=='fibers')option.disabled=true;mode='fibers';modeInput.value=mode}
      requestDraw();
    }).catch(error=>{console.warn('Pathway viewer:',error.message);fail('Static view · the interactive pathways could not load.')});
  }
})();
