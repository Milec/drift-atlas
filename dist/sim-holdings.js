// Campaign setup packages, not purchases or recurring production.
import {ASSET_BY_ID} from './sim-catalog.js';
import {planetTraits} from './models.js';

export function holdingPackage(location,faction,{capital=false}={}){
 const {population}=planetTraits(location),tl=location.tl;
 const text=[location.type,location.attributes?.occupation,location.attributes?.purpose,...(location.attributes?.tags||[]).map(t=>t?.name||t)].join(' ').toLowerCase();
 const world=['planet','moon'].includes(location.type),empty=population===0;
 const role=/research|scient|laborator|university/.test(text)?'research':/mine|mining|asteroid|extract|prospector/.test(text)?'mining':/military|naval|garrison|fortress/.test(text)?'military':/intelligence|espionage|spy|secret|pirate|criminal/.test(text)?'intelligence':/station|refuel|trade|merchant/.test(text)?'trade':/ruin/.test(text)||empty?'outpost':world?'settlement':'outpost';
 const pick=(...ids)=>ids.find(id=>{const t=ASSET_BY_ID[id];return t&&t.tl<=tl&&t.level<=faction[t.stat];});
 const defense=pick('pretech-infantry','postech-infantry','hardened-personnel','militia-unit','security-personnel');
 const industry=pick('pretech-manufactory','postech-industry','local-investments','harvesters');
 const intelligence=pick('organization-moles','blackmail','informers');
 const roles={
  research:pick('pretech-researchers','laboratory','informers'),
  mining:pick('postech-industry','harvesters'),
  military:defense,
  intelligence,
  trade:pick('shipping-combine','freighter-contract','franchise','harvesters'),
  outpost:pick('surveyors','harvesters'),
  settlement:industry
 };
 // Sparse/uninhabited worlds have an outpost, not a populous urban economy.
 const size=empty?1:world?(population===null?1:population>=1e8?3:population>=1e5?2:1):/base|station|mine/i.test(location.type)?2:1;
 const count=capital?4:size;
 const candidates=capital?[defense,roles[role],pick('smugglers','informers'),industry,intelligence]:[roles[role],defense,intelligence,industry];
 const templates=[...new Set(candidates.filter(Boolean))].slice(0,count);
 return {role,population,templates,baseHp:capital?null:Math.min(4,empty?1:size+1)};
}
