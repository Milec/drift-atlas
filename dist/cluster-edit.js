import {mapId,automaticBridges,memberGrid} from './clusters.js';
export const sectorPairKey=(a,b)=>JSON.stringify([a,b].sort());
function owners(meta){const result=new Map();for(const m of meta.members)for(const id of Object.keys(m.sector.system))result.set(mapId(m.id,id),m.id);return result;}
// Explicit bridges remain authoritative. Older saves have no rule metadata and
// open as manual connections so their chosen endpoints are never guessed away.
export function connectionConfigs(meta){
 const byStar=owners(meta),settings=new Map((meta.connectionRules||[]).map(r=>[sectorPairKey(r.a,r.b),r])),groups=new Map();
 for(const edge of meta.bridges){const [x,y]=edge,a=byStar.get(x),b=byStar.get(y);if(!a||!b||a===b)throw Error('A cluster connection refers to an unavailable sector or star.');const ids=[a,b].sort(),key=sectorPairKey(a,b);if(!groups.has(key))groups.set(key,{a:ids[0],b:ids[1],pairs:[]});groups.get(key).pairs.push([...edge].sort());}
 return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,g])=>{const saved=settings.get(key),mode=saved?.mode==='auto'?'auto':'manual';return {...g,mode,count:mode==='auto'?saved.count:g.pairs.length};});
}
export function buildMemberEdit(meta,member,edits,name=meta.name){
 const old=meta.members.find(m=>m.id===member.id),moved=!old||old.x!==member.x||old.y!==member.y;
 const members=old?meta.members.map(m=>m.id===member.id?member:m):[...meta.members,member],byId=new Map(members.map(m=>[m.id,m])),configs=connectionConfigs(meta),original=new Map(configs.map(c=>[sectorPairKey(c.a,c.b),c]));
 const allOwners=owners({members}),bridges=meta.bridges.filter(([a,b])=>allOwners.get(a)!==member.id&&allOwners.get(b)!==member.id).map(e=>[...e]),rules=configs.filter(c=>c.a!==member.id&&c.b!==member.id).map(({a,b,mode,count})=>({a,b,mode,count})),seen=new Set();
 for(const edit of edits){
  if(!byId.has(edit.peer)||edit.peer===member.id||seen.has(edit.peer))throw Error('Choose each connection sector only once.');seen.add(edit.peer);if(!edit.enabled)continue;
  const peer=byId.get(edit.peer),key=sectorPairKey(member.id,peer.id),prior=original.get(key),mode=edit.mode==='auto'?'auto':'manual';let pairs;
  if(mode==='auto'){
   if(!Number.isInteger(edit.count)||edit.count<1||edit.count>3)throw Error('Automatic connections need one, two, or three star pairs per sector.');
   const regenerate=moved||edit.regenerate||!prior||prior.mode!=='auto'||prior.count!==edit.count;
   pairs=regenerate?automaticBridges(member,peer,'custom',edit.count):prior.pairs;
  }else pairs=edit.pairs;
  if(!Array.isArray(pairs)||!pairs.length)throw Error('Choose at least one star pair for a manual connection.');
  const unique=new Set();for(const e of pairs){if(!Array.isArray(e)||e.length!==2)throw Error('Choose a valid star pair.');const a=allOwners.get(e[0]),b=allOwners.get(e[1]);if(!a||!b||!((a===member.id&&b===peer.id)||(b===member.id&&a===peer.id)))throw Error('Each pair must join the selected sector to its chosen connection sector.');const edge=[...e].sort(),edgeKey=JSON.stringify(edge);if(unique.has(edgeKey))throw Error('Choose a different star pair for each lane.');unique.add(edgeKey);bridges.push(edge);}
  const [a,b]=[member.id,peer.id].sort();rules.push({a,b,mode,count:mode==='auto'?edit.count:pairs.length});
 }
 return {...meta,name,members,bridges,connectionRules:rules};
}
export function removeClusterMember(meta,id){
 if(!meta.members.some(m=>m.id===id))throw Error('Choose a sector to remove.');if(meta.members.length===1)throw Error('Keep at least one sector in the cluster.');
 const byStar=owners(meta),bridges=meta.bridges.filter(([a,b])=>byStar.get(a)!==id&&byStar.get(b)!==id).map(e=>[...e]),connectionRules=connectionConfigs(meta).filter(c=>c.a!==id&&c.b!==id).map(({a,b,mode,count})=>({a,b,mode,count}));
 return {...meta,members:meta.members.filter(m=>m.id!==id),bridges,connectionRules};
}
export function nearbyMembers(meta,member,distance=3){
 const a=memberGrid(member);return meta.members.filter(m=>{if(m.id===member.id)return false;const b=memberGrid(m),dx=Math.max(0,a.minX-b.maxX,b.minX-a.maxX),dy=Math.max(0,a.minY-b.maxY,b.minY-a.maxY);return Math.hypot(dx,dy)<=distance;});
}
