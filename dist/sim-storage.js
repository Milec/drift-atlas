// Simulation state follows the campaign through cluster composition and extraction.
const clone=v=>structuredClone(v);
function mapRefs(value,ids){if(typeof value==='string')return ids.get(value)||value;if(Array.isArray(value))return value.map(v=>mapRefs(v,ids));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[ids.get(k)||k,mapRefs(v,ids)]));return value;}
export function composeSimulation(meta){
 let sim=meta.simulation?.version===1?clone(meta.simulation):null;const known=new Set(sim?.memberIds||[]),current=meta.members.map(m=>m.id);
 if(sim&&JSON.stringify([...known].sort())!==JSON.stringify([...current].sort()))sim.undo=null;
 for(const member of meta.members){if(known.has(member.id))continue;const source=member.sector._driftAtlas?.simulation;if(source?.version!==1)continue;const ids=new Map();for(const [type,group] of Object.entries(member.sector)){if(type.startsWith('_')||!group||typeof group!=='object'||Array.isArray(group))continue;for(const id of Object.keys(group))ids.set(id,member.id+'::'+encodeURIComponent(id));}const incoming=mapRefs(source,ids);incoming.undo=null;
  if(!sim){sim=clone(incoming);sim.assets=[];sim.factions={};sim.initializedHoldings={};}
  sim.initializedHoldings={...sim.initializedHoldings,...incoming.initializedHoldings};
  const sameCampaign=sim.id===incoming.id;const assetIds=new Set(sim.assets.map(a=>a.id));for(const a of incoming.assets||[]){let id=a.id;if(assetIds.has(id)){// Re-importing a saved copy is a distinct placement.
    id=member.id+':'+id;
   }assetIds.add(id);sim.assets.push({...a,id});}
  for(const [id,f] of Object.entries(incoming.factions||{}))if(!sim.factions[id]){sim.factions[id]=f;if(incoming.orders?.[id])sim.orders[id]=incoming.orders[id];}else if(!sim.factions[id].home&&f.home)sim.factions[id].home=f.home;
  if(sameCampaign)sim.nextAsset=Math.max(sim.nextAsset||1,incoming.nextAsset||1);
 }
 if(sim)sim.memberIds=current;return sim;
}
export function extractSimulation(sim,ids){if(sim?.version!==1)return null;const out=clone(sim);out.assets=out.assets.filter(a=>ids.has(a.locationId));const localAssets=new Set(out.assets.map(a=>a.id));out.orders=Object.fromEntries(Object.entries(out.orders||{}).filter(([,o])=>o.locationId?ids.has(o.locationId):o.assetId?localAssets.has(o.assetId):true));out.undo=null;delete out.memberIds;if(out.initializedHoldings)out.initializedHoldings=Object.fromEntries(Object.entries(out.initializedHoldings).filter(([id])=>ids.has(id)));
 for(const f of Object.values(out.factions)){if(!ids.has(f.home))f.home=null;if(f.seizing&&!ids.has(f.seizing.locationId))f.seizing=null;if(f.relocating&&!ids.has(f.relocating.locationId))f.relocating=null;}
 return mapRefs(out,ids);
}
