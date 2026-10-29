import {composeSimulation,extractSimulation} from './sim-storage.js';
import {buildLanes} from './navigation.js';
const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export const newId=()=>crypto.randomUUID();
export const clusterOf=d=>d?._driftAtlasCluster||null;
export const mapId=(member,id)=>member+'::'+encodeURIComponent(id);
export const sectorName=d=>Object.values(d.sector||{})[0]?.name||'Uncharted sector';
export function validateSector(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||clusterOf(d)||!d.system||Array.isArray(d.system)||typeof d.system!=='object'||!Object.keys(d.system).length)throw Error('Choose a single Sectors Without Number sector JSON.');
 let count=0;for(const type of ['system','blackHole'])for(const n of Object.values(d[type]||{})){count++;if(!n||!Number.isFinite(Number(n.x))||!Number.isFinite(Number(n.y)))throw Error('Systems need numeric X and Y coordinates.');}
 if(count>3000)throw Error('The atlas supports up to 3,000 map entities.');
}
export function prepareSector(d){
 validateSector(d);const out=structuredClone(d),edits=out._driftAtlas?.systems||{},ns=[];
 for(const type of ['system','blackHole'])for(const [id,n]of Object.entries(out[type]||{})){
  n.x=Number(n.x);n.y=Number(n.y);n.z=Number.isFinite(edits[id]?.z)?edits[id].z:Number.isFinite(n.z)?n.z:Math.round(((hash(id)%1000)/999*2-1)*240)/100;
  edits[id]={...edits[id],z:n.z};
  if(type==='system'&&!edits[id].stellarClass){const roll=hash('spectral:'+id)%100;edits[id].stellarClass=roll<35?'M':roll<60?'K':roll<75?'G':roll<85?'F':roll<93?'A':roll<99?'B':'O';}
  ns.push({id,...n,type});
 }
 out._driftAtlas={...out._driftAtlas,version:1,systems:edits,lanes:buildLanes(ns,out._driftAtlas?.lanes)};return out;
}
export function sectorGrid(d){
 const ns=[...Object.values(d.system||{}),...Object.values(d.blackHole||{})],xs=ns.map(n=>Number(n.x)),ys=ns.map(n=>Number(n.y)),s=Object.values(d.sector||{})[0]||{};
 const minX=Math.min(.5,...xs.map(x=>x-.5)),minY=Math.min(.5,...ys.map(y=>y-.5));
 const maxX=Math.max(minX+(Number(s.columns)||8),...xs.map(x=>x+.5)),maxY=Math.max(minY+(Number(s.rows)||10),...ys.map(y=>y+.5));
 if(maxX-minX>1000||maxY-minY>1000)throw Error('Sector grids must be within 1,000 map units.');
 return {minX,minY,maxX,maxY};
}
export function memberGrid(member){const g=sectorGrid(member.sector);return {minX:g.minX+member.x,maxX:g.maxX+member.x,minY:g.minY+member.y,maxY:g.maxY+member.y};}
export function clusterBounds(meta){const gs=meta.members.map(memberGrid),minX=Math.min(...gs.map(g=>g.minX)),maxX=Math.max(...gs.map(g=>g.maxX)),minY=Math.min(...gs.map(g=>g.minY)),maxY=Math.max(...gs.map(g=>g.maxY));return {minX,maxX,minY,maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2,extent:Math.max(8,maxX-minX+3,maxY-minY+3)};}
export function createCluster(source,name=sectorName(source)+' Cluster'){
 return composeCluster({version:1,id:newId(),name,members:[{id:newId(),x:0,y:0,sector:prepareSector(source)}],bridges:[]});
}
function rewrite(value,ids){if(typeof value==='string')return ids.get(value)||value;if(Array.isArray(value))return value.map(v=>rewrite(v,ids));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,ids)]));return value;}
export function composeCluster(input){
 if(!input||input.version!==1||typeof input.id!=='string'||!input.id||!Array.isArray(input.members)||!input.members.length||!Array.isArray(input.bridges))throw Error('Invalid cluster JSON.');
 const meta=structuredClone(input);meta.name=String(meta.name||'Untitled Cluster').trim().slice(0,100)||'Untitled Cluster';
 const out={},idsSeen=new Set(),systems={},factions={},lanes=[],validStars=new Map();let total=0;
 for(const m of meta.members){
  if(typeof m.id!=='string'||!m.id||idsSeen.has(m.id)||!Number.isFinite(m.x)||!Number.isFinite(m.y)||Math.abs(m.x)>10000||Math.abs(m.y)>10000)throw Error('Invalid cluster member or placement.');
  idsSeen.add(m.id);m.sector=prepareSector(m.sector);sectorGrid(m.sector);const idMap=new Map();
  for(const [type,group]of Object.entries(m.sector)){if(type.startsWith('_')||!group||typeof group!=='object'||Array.isArray(group))continue;for(const id of Object.keys(group))idMap.set(id,mapId(m.id,id));}
  for(const [type,group]of Object.entries(m.sector)){
   if(type.startsWith('_')||!group||typeof group!=='object'||Array.isArray(group))continue;
   out[type]||={};for(const [id,n]of Object.entries(group)){
    const copy=rewrite(n,idMap);
    if(copy&&typeof copy==='object'&&!Array.isArray(copy)){
     copy._clusterMember=m.id;copy._sourceId=id;
     if(['system','blackHole'].includes(type)){copy.x=Number(n.x)+m.x;copy.y=Number(n.y)+m.y;total++;}
    }
    out[type][idMap.get(id)]=copy;
    if(type==='system')validStars.set(idMap.get(id),m.id);
   }
  }
  Object.assign(factions,m.sector._driftAtlas.factions||{});
  for(const [id,a]of Object.entries(m.sector._driftAtlas.systems))systems[mapId(m.id,id)]=a;
  for(const [a,b]of m.sector._driftAtlas.lanes)lanes.push([mapId(m.id,a),mapId(m.id,b)]);
 }
 if(total>3000)throw Error('This cluster would exceed 3,000 map entities.');
 for(let i=0;i<meta.members.length;i++)for(let j=i+1;j<meta.members.length;j++){const a=memberGrid(meta.members[i]),b=memberGrid(meta.members[j]);if(gridsOverlap(a,b))throw Error('These sector grids overlap. Choose a different reference sector or direction.');}
 const unique=new Map();for(const edge of meta.bridges){if(!Array.isArray(edge)||edge.length!==2||!validStars.has(edge[0])||!validStars.has(edge[1])||validStars.get(edge[0])===validStars.get(edge[1]))throw Error('Cluster connections must join stars in different sectors.');const e=[...edge].sort();unique.set(JSON.stringify(e),e);}
 if(meta.connectionRules!==undefined){
  if(!Array.isArray(meta.connectionRules))throw Error('Invalid connection settings.');const used=new Set();
  for(const r of meta.connectionRules){const key=JSON.stringify([r?.a,r?.b].sort());if(!r||!idsSeen.has(r.a)||!idsSeen.has(r.b)||r.a===r.b||!['auto','manual'].includes(r.mode)||!Number.isInteger(r.count)||r.count<1||(r.mode==='auto'&&r.count>3)||used.has(key))throw Error('Invalid connection settings.');used.add(key);}
 }
 meta.bridges=[...unique.values()];out._driftAtlasCluster=meta;out._driftAtlas={version:1,systems,factions,lanes:[...lanes,...meta.bridges]};const simulation=composeSimulation(meta);if(simulation){out._driftAtlas.simulation=simulation;meta.simulation=structuredClone(simulation);}return out;
}
export function extractSector(combined,memberId){
 const meta=clusterOf(combined),m=meta?.members.find(m=>m.id===memberId);if(!m)throw Error('Choose a sector in the current cluster.');
 const out=structuredClone(m.sector),edits=out._driftAtlas?.systems||{},inverse=new Map();
 for(const [type,group]of Object.entries(out)){if(type.startsWith('_')||!group||typeof group!=='object'||Array.isArray(group))continue;for(const id of Object.keys(group)){const key=mapId(m.id,id);inverse.set(key,id);if(combined._driftAtlas?.systems?.[key])edits[id]=structuredClone(combined._driftAtlas.systems[key]);if(['system','blackHole'].includes(type)&&Number.isFinite(combined[type]?.[key]?.z))out[type][id].z=combined[type][key].z;}}
 const lanes=(combined._driftAtlas?.lanes||[]).filter(([a,b])=>inverse.has(a)&&inverse.has(b)).map(([a,b])=>[inverse.get(a),inverse.get(b)]);
 out._driftAtlas={...out._driftAtlas,version:1,systems:edits,factions:structuredClone(combined._driftAtlas?.factions||{}),lanes};const simulation=extractSimulation(combined._driftAtlas?.simulation,inverse);if(simulation)out._driftAtlas.simulation=simulation;else delete out._driftAtlas.simulation;return out;
}
export function syncCluster(combined){
 const meta=clusterOf(combined);if(!meta)return combined;
 if(combined._driftAtlas?.simulation){meta.simulation=structuredClone(combined._driftAtlas.simulation);meta.simulation.memberIds=meta.members.map(m=>m.id);}
 for(const m of meta.members)m.sector=extractSector(combined,m.id);
 // Bridges are canonical and independent of the generated internal lane networks.
 meta.bridges=(combined._driftAtlas?.lanes||[]).filter(([a,b])=>combined.system?.[a]?._clusterMember!==combined.system?.[b]?._clusterMember&&combined.system?.[a]&&combined.system?.[b]);
 return combined;
}
export function gridsOverlap(a,b){return Math.min(a.maxX,b.maxX)>Math.max(a.minX,b.minX)+.001&&Math.min(a.maxY,b.maxY)>Math.max(a.minY,b.minY)+.001;}
export function positionMember(meta,source,anchorId,direction,id=newId(),position=null){
 const anchor=meta.members.find(m=>m.id===anchorId);if(!anchor)throw Error('Choose a reference sector.');
 const sector=source,a=memberGrid(anchor),g=sectorGrid(sector),width=g.maxX-g.minX,height=g.maxY-g.minY,gap=2;
 if(direction==='custom'){
  if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.y)||Math.abs(position.x)>10000||Math.abs(position.y)>10000)throw Error('Enter X and Y offsets between −10,000 and 10,000.');
  return {id,x:position.x,y:position.y,sector};
 }
 let left=(a.minX+a.maxX-width)/2,top=(a.minY+a.maxY-height)/2;
 if(direction==='left')left=a.minX-gap-width;else if(direction==='right')left=a.maxX+gap;else if(direction==='top')top=a.minY-gap-height;else if(direction==='bottom')top=a.maxY+gap;else throw Error('Choose a direction or custom placement.');
 return {id,x:left-g.minX,y:top-g.minY,sector};
}
export function placeMember(meta,source,anchorId,direction,id=newId(),position=null){
 const member=positionMember(meta,prepareSector(source),anchorId,direction,id,position);
 composeCluster({...meta,members:[...meta.members,member]});return member;
}
export function facingDirection(anchor,added){const a=memberGrid(anchor),b=memberGrid(added),dx=(b.minX+b.maxX-a.minX-a.maxX)/2,dy=(b.minY+b.maxY-a.minY-a.maxY)/2;return Math.abs(dx)>=Math.abs(dy)?dx>=0?'right':'left':dy>=0?'bottom':'top';}
export function automaticBridges(anchor,added,direction,count=1){
 if(!Number.isInteger(count)||count<1||count>3)throw Error('Choose one, two, or three star pairs.');
 if(direction==='custom')direction=facingDirection(anchor,added);
 const vertical=['top','bottom'].includes(direction),axis=vertical?'y':'x',positive=['right','bottom'].includes(direction);
 const candidates=(m,high)=>{let ns=Object.entries(m.sector.system).filter(([,n])=>!n.isHidden).map(([id,n])=>({id:mapId(m.id,id),x:n.x+m.x,y:n.y+m.y,z:n.z||0}));ns.sort((a,b)=>(high?b[axis]-a[axis]:a[axis]-b[axis])||a.id.localeCompare(b.id));return ns.slice(0,Math.max(3,Math.ceil(ns.length*.25)));};
 const as=candidates(anchor,positive),bs=candidates(added,!positive),pairs=[];
 for(const a of as)for(const b of bs)pairs.push({edge:[a.id,b.id],distance:Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)});
 pairs.sort((a,b)=>a.distance-b.distance||JSON.stringify(a.edge).localeCompare(JSON.stringify(b.edge)));
 const used=new Set(),out=[];for(const p of pairs){if(p.edge.some(id=>used.has(id)))continue;out.push(p.edge);p.edge.forEach(id=>used.add(id));if(out.length===count)break;}
 if(out.length<count)throw Error('Not enough visible edge stars for that many pairs. Choose fewer connections or manual mode.');return out;
}
