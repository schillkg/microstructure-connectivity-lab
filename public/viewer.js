(() => {
  'use strict';
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const n=Math.hypot(...a);return a.map(v=>v/n)};
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
  out vec3 vNormal;
  void main(){
    vec3 axis=normalize(aEnd-aStart);
    vec3 side=normalize(cross(axis,abs(axis.z)<.9?vec3(0,0,1):vec3(0,1,0)));
    vec3 normal=side*aCylinder.x+cross(axis,side)*aCylinder.y;
    vec3 p=uRotation*(mix(aStart,aEnd,aCylinder.z)+normal*uRadius);
    vNormal=uRotation*normal;
    gl_Position=vec4(p.xy*uFit,-p.z*.35,1);
  }`;
  const tubeFragment=`#version 300 es
  precision highp float;
  in vec3 vNormal; uniform vec3 uColor; out vec4 color;
  void main(){
    vec3 n=normalize(vNormal),light=normalize(vec3(-.45,.65,1));
    float diffuse=max(0.,dot(n,light));
    float fill=max(0.,dot(n,normalize(vec3(.8,-.4,.4))));
    float specular=pow(max(0.,dot(reflect(-light,n),vec3(0,0,1))),26.);
    color=vec4(uColor*(.27+.7*diffuse+.24*fill)+vec3(.28)*specular,1);
  }`;
  const brainVertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aNormal;
  uniform mat3 uRotation; uniform vec2 uFit; out vec3 vNormal;
  void main(){vec3 p=uRotation*aPosition;vNormal=uRotation*aNormal;gl_Position=vec4(p.xy*uFit,-p.z*.35,1);}`;
  const brainFragment=`#version 300 es
  precision highp float;
  in vec3 vNormal; uniform float uAlpha; out vec4 color;
  void main(){
    vec3 n=normalize(vNormal);float rim=pow(1.-abs(n.z),3.);
    float light=.65+.35*abs(dot(n,normalize(vec3(-.5,.8,1))));
    color=vec4(vec3(.53,.72,.79)*light,uAlpha+.16*rim);
  }`;
  for(const panel of document.querySelectorAll('[data-tract-viewer]')){
    const canvas=panel.querySelector('canvas'),status=panel.querySelector('[data-viewer-status]');
    const fallback=panel.querySelector('[data-viewer-fallback]');
    const choices=[...panel.querySelectorAll('[data-bundle]')];
    const turn=panel.querySelector('[data-turn]'),tilt=panel.querySelector('[data-tilt]');
    const glass=panel.querySelector('[data-glass]');
    let yaw=0,pitch=0,selected='all',showGlass=true,dirty=false,dragging=null,data,models=[];
    let tube,brain,brainVAO,camera,right,up;
    const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'low-power'});
    function fail(message){status.textContent=message;canvas.hidden=true;fallback.hidden=false;panel.querySelectorAll('button,input').forEach(el=>el.disabled=true);panel.dataset.viewerState='fallback'}
    if(!gl){fail('Static view · interactive rotation needs WebGL 2.');continue}
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s};
    function program(vs,fs){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return {program:p,rotation:gl.getUniformLocation(p,'uRotation'),fit:gl.getUniformLocation(p,'uFit'),color:gl.getUniformLocation(p,'uColor'),radius:gl.getUniformLocation(p,'uRadius'),alpha:gl.getUniformLocation(p,'uAlpha')}}
    function attribute(index,array,size,stride=0,offset=0,divisor=0){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,stride,offset);gl.vertexAttribDivisor(index,divisor);return b}
    function requestDraw(){if(!dirty){dirty=true;requestAnimationFrame(draw)}}
    function rotation(){
      const a=yaw*Math.PI/180,b=pitch*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
      const r=right.map((v,i)=>ca*v+sa*camera[i]);
      const u=up.map((v,i)=>cb*v+sb*sa*right[i]-sb*ca*camera[i]);
      const c=camera.map((v,i)=>cb*ca*v-cb*sa*right[i]+sb*up[i]);
      return new Float32Array([r[0],u[0],c[0],r[1],u[1],c[1],r[2],u[2],c[2]]);
    }
    function draw(){
      dirty=false;if(!data||gl.isContextLost())return;
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);
      if(!rect.width||!rect.height)return;
      const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      gl.viewport(0,0,w,h);gl.clearColor(8/255,15/255,18/255,1);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
      const fit=.94/data.meta.displayBounds.radius,rot=rotation();
      const set=p=>{gl.useProgram(p.program);gl.uniformMatrix3fv(p.rotation,false,rot);gl.uniform2f(p.fit,Math.min(w,h)/w*fit,Math.min(w,h)/h*fit)};
      const shell=(face,alpha)=>{set(brain);gl.bindVertexArray(brainVAO);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.enable(gl.CULL_FACE);gl.cullFace(face);gl.uniform1f(brain.alpha,alpha);gl.drawElements(gl.TRIANGLES,data.brainIndices.length,gl.UNSIGNED_SHORT,0)};
      if(showGlass)shell(gl.FRONT,.022);
      gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.depthMask(true);set(tube);gl.uniform1f(tube.radius,.00165);
      let count=0;
      for(const model of models){if(selected!=='all'&&model.id!==selected)continue;gl.bindVertexArray(model.vao);gl.uniform3fv(tube.color,model.color);gl.drawElementsInstanced(gl.TRIANGLES,36,gl.UNSIGNED_SHORT,0,model.segments);count+=model.streamlines}
      if(showGlass)shell(gl.BACK,.035);
      gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.bindVertexArray(null);
      status.textContent=count.toLocaleString()+' streamlines · drag to rotate';
      panel.dataset.viewerState='ready';canvas.dataset.streamlines=String(count);
      choices.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bundle===selected)));
      glass.setAttribute('aria-pressed',String(showGlass));
      if(turn){turn.value=yaw;panel.querySelector('[data-turn-value]').value=Math.round(yaw)+'°'}
      if(tilt){tilt.value=pitch;panel.querySelector('[data-tilt-value]').value=Math.round(pitch)+'°'}
    }
    choices.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.bundle;requestDraw()}));
    glass.addEventListener('click',()=>{showGlass=!showGlass;requestDraw()});
    panel.querySelector('[data-reset]').addEventListener('click',()=>{yaw=0;pitch=0;showGlass=true;requestDraw()});
    turn?.addEventListener('input',()=>{yaw=Number(turn.value);requestDraw()});
    tilt?.addEventListener('input',()=>{pitch=Number(tilt.value);requestDraw()});
    canvas.addEventListener('pointerdown',ev=>{dragging={x:ev.clientX,y:ev.clientY,yaw,pitch};canvas.setPointerCapture(ev.pointerId);canvas.classList.add('dragging')});
    canvas.addEventListener('pointermove',ev=>{if(!dragging)return;yaw=((dragging.yaw+(ev.clientX-dragging.x)*.4+540)%360)-180;pitch=Math.max(-89,Math.min(89,dragging.pitch+(ev.clientY-dragging.y)*.4));requestDraw()});
    const stop=()=>{dragging=null;canvas.classList.remove('dragging')};
    canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
    canvas.addEventListener('keydown',ev=>{const steps={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]};if(!steps[ev.key])return;ev.preventDefault();yaw=((yaw+steps[ev.key][0]+540)%360)-180;pitch=Math.max(-89,Math.min(89,pitch+steps[ev.key][1]));requestDraw()});
    canvas.addEventListener('webglcontextlost',ev=>{ev.preventDefault();fail('The 3D view was interrupted. Reload to restore rotation.')});
    new ResizeObserver(requestDraw).observe(canvas);
    loadGeometry(canvas.dataset.source).then(value=>{
      data=value;camera=unit(data.meta.initialView.direction);right=unit(cross(camera.map(v=>-v),data.meta.initialView.up));up=cross(right,camera.map(v=>-v));
      tube=program(tubeVertex,tubeFragment);brain=program(brainVertex,brainFragment);
      // One small cylinder is instanced for every original streamline segment.
      // No streamline or vertex sampling is applied.
      const cylinder=[],indices=[];
      for(let z=0;z<2;z++)for(let i=0;i<6;i++)cylinder.push(Math.cos(i*Math.PI/3),Math.sin(i*Math.PI/3),z);
      for(let i=0;i<6;i++){const n=(i+1)%6;indices.push(i,n,i+6,n,n+6,i+6)}
      for(const bundle of data.meta.bundles){
        const segmentCount=bundle.pointCount-bundle.streamlineCount;
        const segments=new Float32Array(segmentCount*6);let k=0;
        for(let s=0;s<bundle.streamlineCount;s++){
          const begin=data.offsets[bundle.offsetOffset+s],end=data.offsets[bundle.offsetOffset+s+1];
          for(let j=begin;j<end-1;j++){segments.set(data.points.subarray(j*3,j*3+6),k);k+=6}
        }
        const vao=gl.createVertexArray();gl.bindVertexArray(vao);attribute(0,new Float32Array(cylinder),3);
        attribute(1,segments,3,24,0,1);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,3,gl.FLOAT,false,24,12);gl.vertexAttribDivisor(2,1);
        const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
        const color=bundle.color.match(/[a-f\d]{2}/gi).map(h=>parseInt(h,16)/255);
        models.push({id:bundle.id,vao,color,segments:segmentCount,streamlines:bundle.streamlineCount});
      }
      brainVAO=gl.createVertexArray();gl.bindVertexArray(brainVAO);attribute(0,data.brainPoints,3);attribute(1,data.brainNormals,3);
      const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.brainIndices,gl.STATIC_DRAW);
      gl.bindVertexArray(null);requestDraw();
    }).catch(error=>{console.warn('Pathway viewer:',error.message);fail('Static view · the interactive pathways could not load.')});
  }
})();
