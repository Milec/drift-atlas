let sampleCanvas;
// Measure each connected flat footprint once. Its area centroid determines
// placement; its area and overall span determine size, never a local open patch.
export function territoryLabels(ctx,mask,name,anchors){
 const scale=ctx.getTransform().a||1,width=mask.width/scale,height=mask.height/scale,step=Math.max(2,Math.ceil(Math.max(width,height)/512));
 sampleCanvas ||= document.createElement('canvas');const cols=Math.max(1,Math.ceil(width/step)),rows=Math.max(1,Math.ceil(height/step)),dx=width/cols,dy=height/rows;sampleCanvas.width=cols;sampleCanvas.height=rows;
 const g=sampleCanvas.getContext('2d',{willReadFrequently:true});g.drawImage(mask,0,0,cols,rows);const pixels=g.getImageData(0,0,cols,rows).data,ids=new Int32Array(cols*rows),parts=[];ids.fill(-1);
 for(let k=0;k<ids.length;k++){
  if(ids[k]>=0||pixels[k*4+3]<235)continue;const id=parts.length,queue=[k];ids[k]=id;let sumX=0,sumY=0,minX=cols,minY=rows,maxX=0,maxY=0;
  for(let j=0;j<queue.length;j++){const at=queue[j],x=at%cols,y=Math.floor(at/cols);sumX+=x+.5;sumY+=y+.5;minX=Math.min(minX,x);maxX=Math.max(maxX,x+1);minY=Math.min(minY,y);maxY=Math.max(maxY,y+1);
   for(const next of [x>0?at-1:-1,x+1<cols?at+1:-1,y>0?at-cols:-1,y+1<rows?at+cols:-1])if(next>=0&&ids[next]<0&&pixels[next*4+3]>=235){ids[next]=id;queue.push(next);}
  }
  parts.push({id,queue,area:queue.length*dx*dy,x:sumX/queue.length*dx,y:sumY/queue.length*dy,w:(maxX-minX)*dx,h:(maxY-minY)*dy,eligible:false});
 }
 for(const p of anchors){const x=Math.floor(p.x/dx),y=Math.floor(p.y/dy);if(x>=0&&x<cols&&y>=0&&y<rows){const id=ids[y*cols+x];if(id>=0)parts[id].eligible=true;}}
 const text=name.toLocaleUpperCase(),characters=Array.from(text);ctx.save();ctx.font='500 100px "DM Sans", sans-serif';const unitWidth=Math.max(1,characters.reduce((sum,c)=>sum+ctx.measureText(c).width,0)/100+Math.max(0,characters.length-1)*.12);ctx.restore();
 return parts.filter(p=>p.eligible&&p.area>=1500).flatMap(part=>{
  // Roughly four times the territory area gives twice the name's span.
  // Overall dimensions keep narrow territories sensible without letting an
  // irregular edge or a small hole dictate the size of the entire name.
  const size=Math.min(Math.sqrt(part.area)*1.1/unitWidth,part.w*.85/unitWidth,part.h*.6/1.4);if(size<4)return [];
  let {x,y}=part;
  // For concave territory whose centroid falls outside its own footprint,
  // use the nearest interior point, with a small inset from the boundary.
  if(ids[Math.floor(y/dy)*cols+Math.floor(x/dx)]!==part.id){let best=null,fallback=null;for(const at of part.queue){const cx=at%cols,cy=Math.floor(at/cols),px=(cx+.5)*dx,py=(cy+.5)*dy,d=(px-x)**2+(py-y)**2,candidate={x:px,y:py,d};if(!fallback||d<fallback.d)fallback=candidate;
    if(cx>1&&cx<cols-2&&cy>1&&cy<rows-2&&[at-2,at+2,at-cols*2,at+cols*2].every(i=>ids[i]===part.id)&&(!best||d<best.d))best=candidate;
   }({x,y}=best||fallback);
  }
  return [{text,x,y,size,width:unitWidth*size,height:size*1.4,area:part.area}];
 });
}
// Layout is computed in a camera-independent, top-down reference plane.
// Reproject these anchors on camera movement; never refit against the viewport.
let layoutCanvas;
const layoutCache=new WeakMap();
export function anchoredTerritoryLabels(cells,catalog){
 const signature=JSON.stringify(catalog),cached=layoutCache.get(cells);if(cached?.signature===signature)return cached.labels;
 const groups=new Map();for(const cell of cells){if(cell.owners.length!==1||cell.poly.length<3)continue;const id=cell.owners[0];if(!catalog[id])continue;if(!groups.has(id))groups.set(id,{polys:[],anchors:[]});const group=groups.get(id);group.polys.push(cell.poly);if(cell.labelEligible&&cell.n)group.anchors.push(cell.n);}
 const labels=[];layoutCanvas ||= document.createElement('canvas');
 for(const [id,{polys,anchors}] of groups){if(!anchors.length)continue;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const poly of polys)for(const p of poly){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  const scale=Math.min(32,1024/Math.max(1,maxX-minX,maxY-minY)),pad=12;
  layoutCanvas.width=Math.ceil((maxX-minX)*scale)+pad*2;layoutCanvas.height=Math.ceil((maxY-minY)*scale)+pad*2;
  const g=layoutCanvas.getContext('2d'),reference=p=>({x:(p.x-minX)*scale+pad,y:(p.y-minY)*scale+pad});g.fillStyle='#fff';
  for(const poly of polys){g.beginPath();poly.forEach((p,i)=>{const q=reference(p);i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y);});g.closePath();g.fill();}
  for(const label of territoryLabels(g,layoutCanvas,catalog[id].name,anchors.map(reference)))labels.push({...label,x:(label.x-pad)/scale+minX,y:(label.y-pad)/scale+minY,size:label.size/scale,width:label.width/scale,height:label.height/scale,area:label.area/(scale*scale),color:catalog[id].color});
 }
 layoutCache.set(cells,{signature,labels});return labels;
}
export function projectTerritoryLabels(labels,project){
 return labels.flatMap(label=>{const p=project(label.x,label.y,0);let scale=p.unitScale;
  // Generic projection fallback for embedders; the atlas supplies its exact
  // camera scale, independent of the plane's foreshortening.
  if(!Number.isFinite(scale)){const x=project(label.x+.01,label.y,0),y=project(label.x,label.y+.01,0),a=(x.x-p.x)/.01,b=(y.x-p.x)/.01,c=(x.y-p.y)/.01,d=(y.y-p.y)/.01,tr=a*a+b*b+c*c+d*d;scale=Math.sqrt((tr+Math.sqrt(Math.max(0,tr*tr-4*(a*d-b*c)**2)))/2);}
  const size=label.size*scale;if(!Number.isFinite(size)||size<9)return [];const ratio=scale;
  return [{...label,x:p.x,y:p.y,size,width:label.width*ratio,height:label.height*ratio}];
 });
}
export function contrastingLabelInk(color){
 const rgb=/^#[0-9a-f]{6}$/i.test(color)?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255):[0,0,0];
 const linear=rgb.map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4),luminance=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
 const dark=(luminance+.05)/.05>=1.05/(luminance+.05);
 return {fill:dark?'#000000':'#ffffff',outline:dark?'#ffffff':'#000000'};
}
export function paintTerritoryLabel(ctx,label,color){
 const ink=contrastingLabelInk(color);
 ctx.save();ctx.font=`500 ${label.size}px "DM Sans", sans-serif`;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle=ink.fill;ctx.globalAlpha=label.opacity??1;ctx.shadowColor=ink.outline;ctx.shadowBlur=1.5;ctx.lineJoin='round';ctx.lineWidth=Math.max(1.5,label.size*.045);ctx.strokeStyle=ink.outline;let x=label.x-label.width/2;
 for(const char of Array.from(label.text)){ctx.strokeText(char,x,label.y);ctx.fillText(char,x,label.y);x+=ctx.measureText(char).width+label.size*.12;}ctx.restore();
}
