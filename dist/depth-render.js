// Actual sprite alpha defines each solid silhouette, including model openings.
// A native-pixel opaque coverage buffer is filled near-to-far. Color is painted
// far-to-near, so transparent effects never replace a foreground body's surface.
function layer(){const canvas=document.createElement('canvas');return {canvas,ctx:canvas.getContext('2d',{willReadFrequently:true}),key:null,raw:null,alpha:null};}
export class DepthRenderer{
 constructor(){this.pool=new Map();this.scale=1;this.coverage=new Uint8Array(0);}
 prepare(objects,{width,height,scale=1},paint){
  this.scale=scale;const fw=Math.max(1,Math.round(width*scale)),fh=Math.max(1,Math.round(height*scale));if(this.coverage.length!==fw*fh)this.coverage=new Uint8Array(fw*fh);else this.coverage.fill(0);
  const ordered=[...objects].sort((a,b)=>b.d-a.d||String(a.n.id).localeCompare(String(b.n.id))),used=new Set();
  for(const p of ordered){
   used.add(p.n.id);p.hidden=true;p.layer=null;const radius=p.bodyExtent+2,left=Math.max(0,Math.floor((p.x-radius)*scale)),top=Math.max(0,Math.floor((p.y-radius)*scale)),right=Math.min(fw,Math.ceil((p.x+radius)*scale)),bottom=Math.min(fh,Math.ceil((p.y+radius)*scale));if(right<=left||bottom<=top)continue;
   let l=this.pool.get(p.n.id);if(!l){l=layer();this.pool.set(p.n.id,l);}const w=right-left,h=bottom-top;
   const key=p.paintKey===undefined?null:`${p.paintKey}|${w},${h},${scale}|${(p.x*scale-left).toFixed(4)},${(p.y*scale-top).toFixed(4)}`;
   if(key===null||l.key!==key||!l.raw){
    if(l.canvas.width!==w)l.canvas.width=w;if(l.canvas.height!==h)l.canvas.height=h;
    const g=l.ctx;g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-over';g.globalAlpha=1;g.shadowBlur=0;g.clearRect(0,0,w,h);g.setTransform(scale,0,0,scale,-left,-top);paint(g,p);
    l.raw=g.getImageData(0,0,w,h).data;l.key=key;
   }
   if(!l.alpha||l.alpha.length!==w*h)l.alpha=new Uint8Array(w*h);l.left=left;l.top=top;l.width=w;l.height=h;p.layer=l;
  }
  for(let j=ordered.length-1;j>=0;j--){const p=ordered[j],l=p.layer;if(!l)continue;let opaque=false,visibleSolid=false,visibleAny=false,index=0;
   for(let y=0;y<l.height;y++){const row=(l.top+y)*fw+l.left;for(let x=0;x<l.width;x++,index++){const a=l.raw[index*4+3],covered=this.coverage[row+x];l.alpha[index]=covered?0:a;if(a>=254){opaque=true;if(!covered)visibleSolid=true;this.coverage[row+x]=1;}if(!covered&&a>=32)visibleAny=true;}}
   p.hidden=opaque?!visibleSolid:!visibleAny;
  }
  for(const id of this.pool.keys())if(!used.has(id))this.pool.delete(id);return ordered;
 }
 draw(ctx,p){const l=p.layer;if(!l||p.hidden)return;ctx.drawImage(l.canvas,l.left/this.scale,l.top/this.scale,l.width/this.scale,l.height/this.scale);}
 alphaAt(p,x,y){const l=p.layer;if(!l||p.hidden||!l.alpha)return 0;const px=Math.floor(x*this.scale)-l.left,py=Math.floor(y*this.scale)-l.top;if(px<0||py<0||px>=l.width||py>=l.height)return 0;return l.alpha[py*l.width+px];}
}
