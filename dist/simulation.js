import {ASSETS,ASSET_BY_ID,RATING_HP,RATING_XP} from './sim-catalog.js';
import {holdingPackage} from './sim-holdings.js';
import {territorialIncome} from './sim-income.js';
const copy=v=>structuredClone(v),stats=['force','cunning','wealth'];
const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
export const maxHP=f=>4+stats.reduce((n,k)=>n+RATING_HP[Math.max(1,Math.min(8,f[k]||1))],0);
export function definition(a){return a.template==='base'?{id:'base',name:'Base of Influence',stat:'special',level:1,hp:a.maxHp,cost:a.maxHp,tl:0,kind:'Base',attack:'',counter:'',upkeep:0}:ASSET_BY_ID[a.template];}
export function buildWorld(data){
 const entities=new Map(),systems=new Map();for(const [type,group] of Object.entries(data)){if(type.startsWith('_')||!group||typeof group!=='object'||Array.isArray(group))continue;for(const [id,n] of Object.entries(group))if(n?.name){const e={...n,id,type};entities.set(id,e);if(['system','blackHole'].includes(type))systems.set(id,e);}}
 const excluded=new Set(['sector','system','blackHole','note','factions','faction','routes','layers']);const locations=[];
 for(const e of entities.values()){if(excluded.has(e.type))continue;let p=e,root=null,tl=null,seen=new Set();while(p&&!seen.has(p.id)){seen.add(p.id);const raw=p.attributes?.techLevel;if(tl===null&&raw!==undefined){const m=String(raw).match(/(?:TL\s*)?([0-5])/i);if(m)tl=Number(m[1]);}if(systems.has(p.id)){root=p.id;break;}p=entities.get(p.parent);}if(root)locations.push({...e,systemId:root,tl:tl??4,assumedTL:tl===null});}
 for(const e of systems.values())if(!locations.some(l=>l.systemId===e.id))locations.push({...e,systemId:e.id,tl:4,assumedTL:true});
 const byId=new Map(locations.map(l=>[l.id,l])),edges=data._driftAtlas?.lanes||[],adj=new Map([...systems.keys()].map(id=>[id,[]]));for(const [a,b] of edges)if(adj.has(a)&&adj.has(b)){adj.get(a).push(b);adj.get(b).push(a);}
 function jumps(a,b){const from=byId.get(a)?.systemId,to=byId.get(b)?.systemId;if(!from||!to)return Infinity;if(from===to)return 0;const queue=[[from,0]],seen=new Set([from]);for(let i=0;i<queue.length;i++){const [at,d]=queue[i];for(const n of adj.get(at)||[])if(!seen.has(n)){if(n===to)return d+1;seen.add(n);queue.push([n,d+1]);}}return Infinity;}
 return {entities,systems,locations,byId,jumps};
}
export function freshSimulation(seed=Date.now()>>>0){return {version:1,id:crypto.randomUUID(),turn:0,days:0,turnDays:30,seed:seed>>>0,mode:'auto',incomeModel:'territory',factions:{},assets:[],orders:{},history:[],nextAsset:1,undo:null};}
function newAsset(sim,factionId,template,locationId,hp,readyTurn=sim.turn){const d=template==='base'?{hp}:ASSET_BY_ID[template];if(!d)throw Error('Unknown asset template.');const a={id:sim.id+':'+sim.nextAsset++,factionId,template,locationId,hp:d.hp,maxHp:d.hp,readyTurn,hidden:template==='psychic-assassins'||sim.factions[factionId]?.tag==='Secretive',arrears:0};sim.assets.push(a);return a;}
export function seedFactions(data,saved,count=4){const world=buildWorld(data),catalog=data._driftAtlas?.factions||{};if(Object.keys(catalog).length)throw Error('Starting factions are only generated when the map has no factions.');const choices=world.locations.filter(l=>l.type==='planet');if(!choices.length)choices.push(...world.locations);const names=['Aurelian Senate','Delian League','Helios Combine','Nyx Directorate'],colors=['#79dbcf','#db7955','#e3bf74','#a58cdd'];data._driftAtlas||={};data._driftAtlas.factions={};const homes=[];
 for(let i=0;i<Math.min(count,choices.length);i++){const options=choices.filter(l=>!homes.includes(l));const home=i===0?options[0]:options.sort((a,b)=>{const distance=l=>Math.min(...homes.map(h=>{const p=world.systems.get(l.systemId),q=world.systems.get(h.systemId);return Math.hypot(p.x-q.x,p.y-q.y);}));return distance(b)-distance(a);})[0];homes.push(home);const id=crypto.randomUUID();data._driftAtlas.factions[id]={name:names[i%4],color:colors[i%4]};saved[home.id]={...saved[home.id],factionId:id};}
}
export function syncParticipants(sim,data,saved){
 const world=buildWorld(data),catalog=data._driftAtlas?.factions||{};
 for(const [id,f] of Object.entries(sim.factions)){f.archived=!catalog[id];if(catalog[id])f.name=catalog[id].name;}
 for(const [id,entry] of Object.entries(catalog)){
  if(sim.factions[id])continue;
  const homes=world.locations.filter(l=>saved[l.id]?.factionId===id).sort((a,b)=>(b.type==='planet')-(a.type==='planet')||(holdingPackage(b,{force:8,cunning:8,wealth:8}).population||0)-(holdingPackage(a,{force:8,cunning:8,wealth:8}).population||0));
  const home=homes[0]||world.locations.find(l=>!saved[l.id]?.factionId&&!Object.values(sim.factions).some(f=>f.home===l.id));if(!home)continue;
  const i=Object.keys(sim.factions).length,ratings=[[3,2,1],[1,3,2],[2,1,3]][i%3];
  const f={id,name:entry.name,force:ratings[0],cunning:ratings[1],wealth:ratings[2],credits:8,xp:0,home:home.id,style:['expansionist','aggressive','mercantile','cautious'][i%4],control:'auto',tag:'',relations:{},goal:{type:'expand',progress:0,target:1,reward:1},seizing:null,absorbs:false};
  f.hp=maxHP(f);sim.factions[id]=f;
  populateControlledAssets(sim,world,saved,{factionIds:[id],includeHomes:true,scaleRatings:true});
 }
 return sim;
}

// A location is initialized once for the campaign, regardless of later ownership.
// This prevents destroyed, sold, or moved garrisons from being recreated by sync.
export function planControlledAssets(sim,world,saved,{factionIds=Object.keys(sim.factions),includeHomes=false,scaleRatings=false}={}){
 const plan={locations:[],assets:[],profiles:{},economies:{}};
 const future=copy({...sim,undo:null,history:[]});
 for(const id of factionIds){
  const f=future.factions[id];if(!f||f.archived||f.hp<=0)continue;
  const locations=world.locations.filter(l=>(saved[l.id]?.factionId===id||includeHomes&&f.home===l.id)&&!sim.initializedHoldings?.[l.id]);
  if(!locations.length)continue;
  const ratingProfile=scaleRatings?{force:8,cunning:8,wealth:8}:f;
  const packages=locations.map(l=>({location:l,...holdingPackage(l,ratingProfile,{capital:l.id===f.home})}));
  const additions=[];
  for(const p of packages){
   const existing=sim.assets.filter(a=>a.factionId===id&&a.locationId===p.location.id&&a.hp>0);
   const templates=p.templates.filter(t=>!existing.some(a=>a.template===t));
   if(!existing.some(a=>a.template==='base'))templates.unshift('base');
   const entry={factionId:id,locationId:p.location.id,role:p.role,templates};plan.locations.push(entry);
   for(const template of templates)additions.push({factionId:id,locationId:p.location.id,template,hp:template==='base'?p.baseHp:undefined});
  }
  if(scaleRatings){
   const before=maxHP(f),all=[...future.assets.filter(a=>a.factionId===id&&a.hp>0),...additions].filter(a=>a.template!=='base');
   for(const stat of stats){const group=all.filter(a=>ASSET_BY_ID[a.template]?.stat===stat);f[stat]=Math.min(8,Math.max(f[stat],group.length,...group.map(a=>ASSET_BY_ID[a.template].level)));}
   f.hp+=maxHP(f)-before;
  }
  for(const a of additions){if(a.template==='base')a.hp=a.hp===null?maxHP(f):Math.min(a.hp,maxHP(f));newAsset(future,id,a.template,a.locationId,a.hp);plan.assets.push(a);}
  if(scaleRatings){const deficit=Math.max(0,-economy(future,id,{world,saved}).net);f.credits=Math.max(f.credits,8+3*deficit);}
  plan.profiles[id]={force:f.force,cunning:f.cunning,wealth:f.wealth,hp:f.hp,credits:f.credits};
  plan.economies[id]={before:economy(sim,id,{world,saved}),after:economy(future,id,{world,saved})};
 }
 return plan;
}
export function populateControlledAssets(sim,world,saved,options={}){
 const plan=planControlledAssets(sim,world,saved,options);if(!plan.locations.length)return plan;
 sim.initializedHoldings||={};
 for(const [id,profile] of Object.entries(plan.profiles))Object.assign(sim.factions[id],profile);
 for(const a of plan.assets)newAsset(sim,a.factionId,a.template,a.locationId,a.hp);
 for(const l of plan.locations)sim.initializedHoldings[l.locationId]=true;
 sim.undo=null;
 return plan;
}

export function activeAssets(sim,id,turn=sim.turn){return sim.assets.filter(a=>(!id||a.factionId===id)&&a.hp>0&&a.readyTurn<=turn&&!a.arrears&&sim.factions[a.factionId]?.hp>0&&!sim.factions[a.factionId]?.archived);}
export function economy(sim,id,{turn=sim.turn+1,world,saved}={}){const f=sim.factions[id],assets=sim.assets.filter(a=>a.factionId===id&&a.hp>0),counts=Object.fromEntries(stats.map(k=>[k,assets.filter(a=>definition(a)?.stat===k).length])),base=Math.ceil(f.wealth/2)+Math.floor((f.force+f.cunning)/4),over=stats.reduce((n,k)=>n+Math.max(0,counts[k]-f[k]),0),upkeep=assets.reduce((n,a)=>n+Math.max(0,definition(a)?.upkeep||0),0),bonus=assets.filter(a=>a.readyTurn<=turn&&!a.arrears).reduce((n,a)=>n+Math.max(0,-(definition(a)?.upkeep||0)),0);const territory=territorialIncome(sim,id,world,saved);return {base,over,upkeep,bonus,...territory,net:base+bonus+territory.territory-over-upkeep,counts};}
function relation(sim,a,b){if(a===b)return 'ally';return sim.factions[a]?.relations?.[b]||'neutral';}
function available(sim,id,loc){return activeAssets(sim,id,sim.turn).filter(a=>!loc||a.locationId===loc);}
function has(sim,id,template,loc){return available(sim,id,loc).some(a=>a.template===template);}
function canBuyHere(sim,id,loc){return sim.factions[id].home===loc||has(sim,id,'base',loc);}
function techCost(sim,id,t,loc,world){const f=sim.factions[id],l=world.byId.get(loc);if(!l)return {tl:-1,extra:0};let tl=l.tl,extra=0;if(f.tag==='Technical Expertise'&&has(sim,id,'base',loc))tl=Math.max(tl,4);if(t.stat!=='force'&&has(sim,id,'pretech-researchers',loc))tl=Math.max(tl,5);if(t.stat==='wealth'&&has(sim,id,'r-d-department'))tl=Math.max(tl,4);if(t.tl>tl&&t.tl<=4&&has(sim,id,'laboratory',loc)){tl=4;extra+=2;}if(available(sim,null,loc).some(a=>a.factionId!==id&&a.template==='local-investments'))extra++;return {tl,extra};}
function permission(sim,id,t,loc,saved){const owner=saved[loc]?.factionId;return !t.permission||!owner||owner===id||relation(sim,owner,id)==='ally'||has(sim,id,'popular-movement',loc);}
const transports={
 'smugglers':{range:2,cost:1,cargo:'special',self:true},'freighter-contract':{range:2,cost:1,cargo:'nonforce'},'heavy-drop-assets':{range:1,cost:1,cargo:'nonship'},'shipping-combine':{range:2,cost:1,cargo:'nonforce',many:true},'beachhead-landers':{range:1,cost:1,cargo:'any',many:true},'extended-theater':{range:2,cost:1,cargo:'nonship'},'deep-strike-landers':{range:3,cost:2,cargo:'nonship',ignore:true},'blockade-runners':{range:3,cost:2,cargo:'troops',self:true,ignore:true},'covert-shipping':{range:3,cost:1,cargo:'special'},'covert-transit-net':{range:3,cost:0,cargo:'special',many:true},'strike-fleet':{range:1,cost:0,selfOnly:true},'blockade-fleet':{range:1,cost:0,selfOnly:true},'capital-fleet':{range:3,cost:0,selfOnly:true},'scavenger-fleet':{range:3,cost:0,selfOnly:true},'space-marines':{range:1,cost:0,selfOnly:true,ignore:true},'mercenaries':{range:1,cost:0,selfOnly:true},'seductress':{range:1,cost:0,selfOnly:true},'surveyors':{range:2,cost:0,selfOnly:true}
};
export function movement(sim,actor,cargo){const rule=transports[actor.template]||(sim.factions[actor.factionId]?.tag==='Mercenary Group'?{range:1,cost:0,selfOnly:true}:null);if(!rule)return null;const d=definition(cargo);if(!d||d.kind==='Base')return null;if(rule.selfOnly)return actor.id===cargo.id?rule:null;if(actor.id===cargo.id&&rule.self)return rule;const valid=rule.cargo==='any'||rule.cargo==='nonforce'&&d.stat!=='force'||rule.cargo==='nonship'&&d.kind!=='Starship'||rule.cargo==='special'&&d.kind==='Special Forces'||rule.cargo==='troops'&&['Military Unit','Special Forces'].includes(d.kind);return valid?rule:null;}
export function purchaseCost(sim,id,t,loc,world){const base=t.cost+techCost(sim,id,t,loc,world).extra;return Math.max(Math.floor(t.cost/2),base-(sim.factions[id].discount||0));}
export function validateOrder(sim,id,o,world,saved,{afterIncome=false}={}){
 // Queue validation uses the same turn boundary as execution, including upkeep.
 if(!afterIncome){const future=planningState(sim);if(future.factions[id]?.hp>0&&!future.factions[id].archived)prepareFactionTurn(future,id,world,saved);return validateOrder(future,id,o,world,saved,{afterIncome:true});}
 const f=sim.factions[id];if(!f||f.hp<=0||f.archived)return 'Faction is defeated.';if(!o||typeof o.action!=='string')return 'Choose an action.';const funds=Math.max(0,f.credits),asset=sim.assets.find(a=>a.id===o.assetId&&a.factionId===id),target=world.byId.get(o.locationId),ready=a=>a&&a.hp>0&&!a.arrears&&a.readyTurn<=sim.turn,base=asset?.template==='base';
 if(f.seizing&&o.action!=='seize')return 'This faction must finish or lose its ongoing seizure.';
 switch(o.action){
 case 'wait':return '';
 case 'buy':{const t=ASSET_BY_ID[o.template];if(!t)return 'Choose an asset.';if(t.id==='gengineered-slaves'&&f.tag!=='Eugenics Cult')return 'This template requires Eugenics Cult; use a GM asset adjustment for that special faction.';if(!target||!canBuyHere(sim,id,target.id))return 'Purchase at the home location or an active Base of Influence.';if(f[t.stat]<t.level)return 'Faction rating is too low for this asset.';if(techCost(sim,id,t,target.id,world).tl<t.tl)return 'The location’s technology is too low.';if(!permission(sim,id,t,target.id,saved))return 'Government permission is required (ally with the owner).';if(funds<purchaseCost(sim,id,t,target.id,world))return 'Not enough credits.';return '';}
 case 'expand':if(!target)return 'Choose a location.';if(has(sim,id,'base',target.id))return 'There is already a base here.';if(!sim.assets.some(a=>a.factionId===id&&a.locationId===target.id&&ready(a)&&a.template!=='base'))return 'An active asset must already be at the location.';if(!Number.isInteger(o.hp)||o.hp<1||o.hp>maxHP(f))return 'Base HP must be between 1 and faction maximum HP.';return funds<o.hp?'Not enough credits.':'';
 case 'move':{if(!ready(asset))return 'Choose an active transport or mobile asset.';const cargo=sim.assets.find(a=>a.id===(o.cargoId||o.assetId)&&a.factionId===id),rule=cargo&&movement(sim,asset,cargo);if(!ready(cargo)||!rule)return 'This asset cannot transport the selected cargo.';if(cargo.locationId!==asset.locationId)return 'Transport and cargo must start at the same location.';if(!target||target.id===cargo.locationId)return 'Choose a different destination.';if(world.jumps(asset.locationId,target.id)>rule.range)return 'Destination is outside this asset’s lane-jump range.';if(!rule.ignore&&!cargo.hidden&&cargo.template!=='capital-fleet'&&!permission(sim,id,definition(cargo),target.id,saved))return 'Government permission is required at the destination.';return funds<rule.cost?'Not enough credits.':'';}
 case 'attack':if(!target||!sim.factions[o.targetFaction]||o.targetFaction===id)return 'Choose a rival faction and location.';if(!sim.assets.some(a=>a.factionId===id&&a.locationId===target.id&&ready(a)&&definition(a)?.attack))return 'No attacking asset is ready here.';if(!sim.assets.some(a=>a.factionId===o.targetFaction&&a.locationId===target.id&&a.hp>0&&!a.hidden))return 'No visible rival assets at this location.';return '';
 case 'seize':if(!target)return 'Choose a location.';if(f.seizing&&f.seizing.locationId!==target.id)return 'Continue the current seizure at its original location.';if(saved[target.id]?.factionId===id)return 'You already control this location.';return sim.assets.some(a=>a.factionId===id&&a.locationId===target.id&&ready(a)&&!a.hidden)?'':'An active, visible asset must remain here.';
 case 'repairFaction':return f.hp>=maxHP(f)?'Faction HP is already full.':'';
 case 'repair':if(!ready(asset))return 'Choose an active damaged asset.';if(asset.hp>=asset.maxHp)return 'Asset HP is already full.';if(!Number.isInteger(o.amount)||o.amount<1||o.amount>10)return 'Choose 1–10 repair batches.';return funds<repairCost(sim,id,asset,o.amount)?'Not enough credits.':'';
 case 'sell':return asset&&!base?'':'Choose a non-base asset.';
 case 'refit':{if(!ready(asset)||base)return 'Choose an active non-base asset.';const t=ASSET_BY_ID[o.template];if(!t||t.id===asset.template||t.kind!==definition(asset).kind)return 'Refit to a different asset of the same kind.';const buy=validateOrder({...sim,factions:{...sim.factions,[id]:{...f,credits:f.credits+definition(asset).cost}}},id,{action:'buy',template:t.id,locationId:asset.locationId},world,saved,{afterIncome});return buy;}
 case 'use':return ready(asset)&&['harvesters','postech-industry','pretech-manufactory','commodities-broker'].includes(asset.template)?'':'Choose an asset with an automated economic ability. Movement and attacks have separate orders; other special abilities use GM adjustments.';
 case 'home':if(!target||!has(sim,id,'base',target.id))return 'The new home needs an active base.';return Number.isFinite(world.jumps(f.home,target.id))?'':'No lane route to the new home.';
 default:return 'Unknown order.';
 }
}
function repairCost(sim,id,a,n){const discount=has(sim,id,'medical-center',a.locationId)&&['Special Forces','Military Unit'].includes(definition(a).kind)?1:0;return Math.max(0,n*(n+1)/2-discount);}
export function chooseOrder(sim,id,world,saved){const f=sim.factions[id],assets=available(sim,id),valid=o=>!validateOrder(sim,id,o,world,saved,{afterIncome:true});if(f.seizing)return {action:'seize',locationId:f.seizing.locationId};if(f.hp<maxHP(f)*.55)return {action:'repairFaction'};
 const hurt=assets.find(a=>a.hp<a.maxHp*.65);if(hurt&&valid({action:'repair',assetId:hurt.id,amount:1}))return {action:'repair',assetId:hurt.id,amount:1};
 for(const a of assets.filter(a=>definition(a)?.attack)){const enemy=available(sim,null,a.locationId).find(b=>b.factionId!==id&&!b.hidden&&relation(sim,id,b.factionId)!=='ally'&&(relation(sim,id,b.factionId)==='hostile'||f.style==='aggressive'));if(enemy)return {action:'attack',locationId:a.locationId,targetFaction:enemy.factionId};}
 for(const a of assets){if(!world.byId.has(a.locationId))continue;const enemy=available(sim,null,a.locationId).some(b=>b.factionId!==id&&relation(sim,id,b.factionId)!=='ally'&&!b.hidden);if(!enemy&&saved[a.locationId]?.factionId!==id&&!a.hidden&&relation(sim,id,saved[a.locationId]?.factionId)!=='ally')return {action:'seize',locationId:a.locationId};}
 for(const a of assets){const o={action:'expand',locationId:a.locationId,hp:Math.min(4,maxHP(f))};if(valid(o))return o;}
 const mobile=assets.filter(a=>movement(sim,a,a));for(const a of mobile){const targets=world.locations.filter(l=>l.id!==a.locationId&&!assets.some(b=>b.locationId===l.id)&&(!saved[l.id]?.factionId||saved[l.id].factionId!==id&&relation(sim,id,saved[l.id].factionId)!=='ally'&&(f.style==='aggressive'||relation(sim,id,saved[l.id].factionId)==='hostile'))).sort((a1,b)=>{const score=l=>world.jumps(a.locationId,l.id)-(saved[l.id]?.factionId?0.5:0);return score(a1)-score(b);});for(const l of targets){const o={action:'move',assetId:a.id,cargoId:a.id,locationId:l.id};if(valid(o))return o;}}
 const home=assets.filter(a=>a.template==='base').map(a=>a.locationId);if(!home.includes(f.home))home.push(f.home);
 const preferences=mobile.length?['security-personnel','harvesters','party-machine','cyberninjas','strike-fleet']:['smugglers','seductress','surveyors','strike-fleet','security-personnel'];
 if(sim.assets.filter(a=>a.factionId===id&&a.template!=='base').length<stats.reduce((n,k)=>n+f[k],0))for(const key of preferences)for(const loc of home){if(assets.filter(a=>a.template===key).length>=2)continue;const o={action:'buy',template:key,locationId:loc};if(valid(o))return o;}
 const producer=assets.find(a=>['harvesters','postech-industry','pretech-manufactory'].includes(a.template));if(producer)return {action:'use',assetId:producer.id};return {action:'wait'};
}
// Planning must never mutate a campaign, its undo snapshot, or its random seed.
function planningState(sim){const future=copy({...sim,undo:null,history:[]});future.turn++;return future;}
function prepareFactionTurn(sim,id,world,saved,note=()=>{}){
 const f=sim.factions[id];
 for(const a of sim.assets)if(a.jammedBy===id&&a.jammedUntil<sim.turn){delete a.jammedBy;delete a.jammedUntil;}
 const eco=economy(sim,id,{turn:sim.turn,world,saved});
 f.credits=Math.max(0,f.credits+eco.base+eco.bonus+eco.territory-eco.over);
 note(id,`Income ${eco.base} + ${eco.territory} territory + ${eco.bonus} asset income − ${eco.over} overextension; upkeep ${eco.upkeep}.`);
 for(const a of sim.assets.filter(a=>a.factionId===id&&a.hp>0)){
  const upkeep=Math.max(0,definition(a)?.upkeep||0);
  if(f.credits>=upkeep){f.credits-=upkeep;a.arrears=0;}
  else{a.arrears=(a.arrears||0)+1;note(id,definition(a).name+(a.arrears>1?' lost after two unpaid turns.':' disabled: upkeep unpaid.'),a.locationId);if(a.arrears>1)a.hp=0;}
 }
}
export function previewOrders(sim,world,saved){const future=planningState(sim);for(const [id,f] of Object.entries(future.factions))if(f.hp>0&&!f.archived)prepareFactionTurn(future,id,world,saved);return Object.fromEntries(Object.entries(future.factions).filter(([,f])=>f.hp>0&&!f.archived).map(([id,f])=>[id,sim.orders[id]||(sim.mode==='auto'&&f.control!=='manual'?chooseOrder(future,id,world,saved):{action:'wait'})]));}
export function advanceTurn(input,world,ownership){
 const sim=copy(input),saved=copy(ownership),old=copy(input);delete old.undo;sim.undo={simulation:old,ownership:copy(ownership)};sim.turn++;sim.days+=sim.turnDays;const events=[],used=new Set(),bonusUsed=new Set(),thefts=new Set();
 const note=(f,text,locationId)=>events.push({factionId:f,text,locationId:locationId||null});
 function die(sides){sim.seed=(Math.imul(sim.seed,1664525)+1013904223)>>>0;return 1+Math.floor(sim.seed/4294967296*sides);}
 function roll(formula,f){const m=/^(\d+)d(\d+)([+-]\d+)?$/i.exec(String(formula));if(!m)return 0;let total=Number(m[3]||0);for(let i=0;i<Math.min(20,+m[1]);i++){let n=die(+m[2]);if(sim.factions[f]?.tag==='Fanatical')while(n===1)n=die(+m[2]);total+=n;}return Math.max(0,total);}
 function test(fid,stat,extra=false){let a=die(10);if(sim.factions[fid].tag==='Fanatical')while(a===1)a=die(10);if(extra){let b=die(10);if(sim.factions[fid].tag==='Fanatical')while(b===1)b=die(10);a=Math.max(a,b);}return {die:a,total:a+sim.factions[fid][stat]};}
 function bonus(fid,stat,attacking,loc,d,seize){const f=sim.factions[fid],tag=f.tag;const always=!attacking&&tag==='Deep Rooted'&&f.home===loc||attacking&&seize&&tag==='Imperialists';const once=attacking&&({force:'Warlike',cunning:'Machiavellian',wealth:'Plutocratic'})[stat]===tag||!attacking&&(tag==='Theocratic'&&stat==='cunning'||tag==='Savage'&&d.tl===0);if(always)return true;if(once&&!bonusUsed.has(fid)){bonusUsed.add(fid);return true;}return false;}
 function progress(id,kind,n=1){const g=sim.factions[id]?.goal;if(g?.type===kind)g.progress+=n;}
 function damage(a,amount,attacker){const f=sim.factions[a.factionId];let hit=Math.min(a.hp,amount);if(hit>=a.hp&&a.template!=='false-front'){const decoy=available(sim,a.factionId,a.locationId).find(b=>b.template==='false-front');if(decoy){decoy.hp=0;note(a.factionId,'False Front sacrificed to protect '+definition(a).name+'.',a.locationId);return;}}
 a.hp=Math.max(0,a.hp-hit);if(a.template==='base'){f.hp=Math.max(0,f.hp-hit);if(attacker)progress(attacker,'blood',hit);note(a.factionId,`Base takes ${hit} damage; faction loses ${hit} HP.`,a.locationId);if(f.hp===0){note(a.factionId,'Faction collapses. Its locations become unclaimed.');for(const e of Object.values(saved))if(e.factionId===a.factionId)delete e.factionId;if(attacker)progress(attacker,'destroy');}}
 if(a.hp===0){note(a.factionId,definition(a).name+' destroyed.',a.locationId);if(attacker){progress(attacker,definition(a).stat);if(definition(a).stat==='force'&&definition(a).level>sim.factions[attacker].force)progress(attacker,'valor');}for(const id of new Set([attacker,a.factionId]))if(id&&sim.factions[id]?.tag==='Scavengers')sim.factions[id].credits++;}}
 function attacks(fid,targetId,loc,seize=false,forcedBase=null){const f=sim.factions[fid],enemy=sim.factions[targetId];if(!f||!enemy||f.hp<=0||enemy.hp<=0)return;f.relations[targetId]='hostile';enemy.relations[fid]='hostile';const attackers=available(sim,fid,loc).filter(a=>definition(a)?.attack&&!used.has(a.id));for(const a of attackers){if(!a.hp||f.hp<=0||enemy.hp<=0)continue;const ad=definition(a);let defenders=available(sim,targetId,loc).filter(b=>!b.hidden);if(forcedBase?.hp>0&&!defenders.includes(forcedBase))defenders.push(forcedBase);defenders=defenders.filter(b=>!(b.template==='planetary-defenses'&&ad.kind!=='Starship')&&!(b.template==='seductress'&&ad.kind!=='Special Forces')&&!(a.template==='lawyers'&&definition(b).stat==='force'));if(!defenders.length){if(['informers','seductress'].includes(a.template)){const ar=test(fid,'cunning'),dr=test(targetId,'cunning');if(ar.total>=dr.total)for(const b of sim.assets)if(b.factionId===targetId&&b.locationId===loc)b.hidden=false;note(fid,`Reconnaissance ${ar.total} vs ${dr.total}.`,loc);used.add(a.id);}continue;}
 const b=defenders.sort((x,y)=>(x.template==='base')-(y.template==='base')||(rollAverage(definition(y).counter)+y.hp/10)-(rollAverage(definition(x).counter)+x.hp/10))[0],bd=definition(b);used.add(a.id);a.hidden=false;b.hidden=false;
 const blackmail=a.template==='blackmail'||b.template==='blackmail',ar=test(fid,ad.attackStat,!blackmail&&bonus(fid,ad.attackStat,true,loc,ad,seize)),dr=test(targetId,ad.defenseStat,!blackmail&&bonus(targetId,ad.defenseStat,false,loc,bd,false));let hit=ar.total>=dr.total,counter=ar.total<=dr.total;if(ar.total===dr.total){if(f.tag==='Fanatical')hit=false;if(enemy.tag==='Fanatical')counter=false;}
 if(a.template==='saboteurs'){b.jammedUntil=sim.turn;b.jammedBy=a.factionId;}const attackDamage=hit?roll(ad.attack,fid):0,counterDamage=counter&&!(b.template==='lawyers'&&ad.stat==='force')?roll(bd.counter,targetId):0;
 note(fid,`${ad.name} vs ${enemy.name} / ${bd.name}: d10 ${ar.die} + ${f[ad.attackStat]} = ${ar.total}; defense ${dr.die} + ${enemy[ad.defenseStat]} = ${dr.total}. Damage ${attackDamage}; counter ${counterDamage}.`,loc);
 if(ad.manual||bd.manual)note(fid,'Special asset effect requires GM adjudication after this roll.',loc);
 if(hit&&['informers','seductress'].includes(a.template)){for(const x of sim.assets)if(x.factionId===targetId&&x.locationId===loc)x.hidden=false;note(fid,'Hidden rival assets revealed.',loc);}
 if(hit){const shield=enemy.absorbs&&available(sim,targetId,loc).find(x=>x.template==='base');damage(shield||b,attackDamage,fid);if(['franchise','blockade-fleet'].includes(a.template)&&!thefts.has(targetId+':'+a.template)){const amount=Math.min(enemy.credits,a.template==='franchise'?1:die(4));enemy.credits-=amount;f.credits+=amount;thefts.add(targetId+':'+a.template);note(fid,`Transferred ${amount} rival credits.`,loc);}}
 if(counter)damage(a,counterDamage,targetId);if(hit&&a.template==='zealots'&&a.hp>0)damage(a,die(4),null);if(counter&&b.template==='zealots'&&b.hp>0)damage(b,die(4),null);
 }}
 let orderIds=Object.keys(sim.factions).filter(id=>world.entities.size&&sim.factions[id].hp>0&&!sim.factions[id].archived);if(orderIds.length){const first=die(orderIds.length)-1;orderIds=[...orderIds.slice(first),...orderIds.slice(0,first)];}
// Freeze income ownership for the whole turn: a captured orbital cannot pay both sides.
 for(const id of orderIds){const f=sim.factions[id];if(f.hp<=0)continue;prepareFactionTurn(sim,id,world,ownership,note);
 if(f.relocating){f.relocating.remaining--;if(f.relocating.remaining<=0){f.home=f.relocating.locationId;f.relocating=null;if(f.tag==='Deep Rooted')f.tag='';note(id,'Home relocation complete.',f.home);}else note(id,`Relocating home: ${f.relocating.remaining} turns remain.`);continue;}
 let o=sim.orders[id]||(sim.mode==='auto'&&f.control!=='manual'?chooseOrder(sim,id,world,saved):{action:'wait'});if(f.seizing)o={action:'seize',locationId:f.seizing.locationId};const error=validateOrder(sim,id,o,world,saved,{afterIncome:true});if(error){note(id,`Order skipped: ${error}`);if(f.seizing&&!available(sim,id,f.seizing.locationId).some(a=>!a.hidden))f.seizing=null;continue;}
 const a=sim.assets.find(a=>a.id===o.assetId),location=o.locationId||a?.locationId;note(id,'Order: '+o.action+(world.byId.get(location)?' · '+world.byId.get(location).name:''),location);
 switch(o.action){
 case 'wait':break;
 case 'buy':{const t=ASSET_BY_ID[o.template],cost=purchaseCost(sim,id,t,location,world);f.credits-=cost;f.discount=0;newAsset(sim,id,t.id,location,null,sim.turn+1);note(id,`Purchased ${t.name} for ${cost} credits; ready next turn.`,location);break;}
 case 'expand':{f.credits-=o.hp;const base=newAsset(sim,id,'base',location,o.hp,sim.turn+1),r=test(id,'cunning',has(sim,id,'surveyors',location));const rivals=[...new Set(available(sim,null,location).filter(a=>a.factionId!==id&&relation(sim,id,a.factionId)!=='ally').map(a=>a.factionId))];for(const rid of rivals){const oppose=test(rid,'cunning');note(id,`Expansion contest ${r.total} vs ${sim.factions[rid].name} ${oppose.total}.`,location);if(oppose.total>=r.total)attacks(rid,id,location,false,base);}if(base.hp>0)progress(id,'expand');break;}
 case 'attack':attacks(id,o.targetFaction,location);break;
 case 'seize':{f.seizing||={locationId:location,hold:0};const enemies=[...new Set(available(sim,null,location).filter(a=>a.factionId!==id&&!a.hidden&&relation(sim,id,a.factionId)!=='ally').map(a=>a.factionId))];for(const rid of enemies)attacks(id,rid,location,true);const own=available(sim,id,location).some(a=>!a.hidden),enemy=sim.assets.some(a=>a.locationId===location&&a.factionId!==id&&a.hp>0&&!a.hidden&&sim.factions[a.factionId]?.hp>0&&relation(sim,id,a.factionId)!=='ally');if(!own){f.seizing=null;note(id,'Seizure abandoned: no visible assets remain.',location);}else if(enemy){f.seizing.hold=0;note(id,'Seizure contested; resistance remains.',location);}else{f.seizing.hold++;note(id,`Occupation maintained ${f.seizing.hold}/3 turns.`,location);if(f.seizing.hold>=3){saved[location]={...saved[location],factionId:id};progress(id,'seize');f.seizing=null;note(id,'Government established. Map ownership updated.',location);}}break;}
 case 'move':{const cargo=sim.assets.find(b=>b.id===(o.cargoId||o.assetId)),rule=movement(sim,a,cargo);f.credits-=rule.cost;cargo.locationId=location;if(a.template==='smugglers'&&a.id!==cargo.id)a.locationId=location;note(id,`${definition(cargo).name} relocated for ${rule.cost} credits.`,location);break;}
 case 'repair':{const batches=o.amount,rate=a.template==='base'?Math.max(...stats.map(k=>f[k])):f[definition(a).stat],heal=Math.min(a.maxHp-a.hp,rate*batches);f.credits-=repairCost(sim,id,a,batches);a.hp+=heal;note(id,`${definition(a).name} repaired ${heal} HP.`,a.locationId);break;}
 case 'repairFaction':{const heal=Math.min(maxHP(f)-f.hp,Math.round((Math.max(...stats.map(k=>f[k]))+Math.min(...stats.map(k=>f[k])))/2));f.hp+=heal;note(id,`Faction recovered ${heal} HP.`);break;}
 case 'sell':{const credits=Math.floor(definition(a).cost/2);f.credits+=credits;a.hp=0;note(id,`Sold ${definition(a).name} for ${credits} credits.`,a.locationId);break;}
 case 'refit':{const t=ASSET_BY_ID[o.template],cost=Math.max(0,purchaseCost(sim,id,t,a.locationId,world)-definition(a).cost);f.credits-=cost;f.discount=0;a.template=t.id;a.hp=t.hp;a.maxHp=t.hp;a.readyTurn=sim.turn+1;note(id,`Refit to ${t.name} for ${cost} credits; ready next turn.`,a.locationId);break;}
 case 'home':f.relocating={locationId:location,remaining:world.jumps(f.home,location)};if(!f.relocating.remaining){f.home=location;f.relocating=null;if(f.tag==='Deep Rooted')f.tag='';}break;
 case 'use':{if(a.jammedBy){note(id,'Ability blocked by sabotage.',a.locationId);break;}let amount=0,r=0;if(a.template==='harvesters'){r=die(6);amount=r>=3?1:0;}if(a.template==='postech-industry'){r=die(6);amount=r===1?-1:r<=4?1:2;}if(a.template==='pretech-manufactory'){r=die(8);amount=Math.ceil(r/2);}if(a.template==='commodities-broker'){r=die(8);f.discount=r;note(id,`Next purchase discounted by up to ${r} credits.`,a.locationId);}else{if(f.credits+amount<0){a.hp=0;note(id,'Industry closed: unable to cover operating loss.',a.locationId);}f.credits=Math.max(0,f.credits+amount);note(id,`Economic roll ${r}: ${amount>=0?'+':''}${amount} credits.`,a.locationId);}break;}
 }
 if(f.goal?.type==='peace'){f.goal.progress=['attack','seize'].includes(o.action)?0:f.goal.progress+1;}
 if(f.goal&&f.goal.progress>=f.goal.target){f.xp+=f.goal.reward;note(id,`Goal completed: ${f.goal.type}. +${f.goal.reward} XP.`);f.goal={type:f.style==='cautious'?'peace':'expand',progress:0,target:f.style==='cautious'?4:1,reward:1};}
 if(sim.mode==='auto'&&f.control!=='manual'){const stat=stats.slice().sort((a,b)=>f[b]-f[a])[0];if(f[stat]<8&&f.xp>=RATING_XP[f[stat]+1]){const before=maxHP(f);f.xp-=RATING_XP[f[stat]+1];f[stat]++;f.hp+=maxHP(f)-before;f.upgrades||={};f.upgrades[stat]=sim.turn;note(id,`${stat} increased to ${f[stat]}.`);}}
 }
 sim.undo.changes=[...new Set([...Object.keys(ownership),...Object.keys(saved)])].filter(id=>ownership[id]?.factionId!==saved[id]?.factionId).map(id=>({id,before:ownership[id]?.factionId,after:saved[id]?.factionId}));delete sim.undo.ownership;sim.assets=sim.assets.filter(a=>a.hp>0);sim.orders={};sim.history.push({turn:sim.turn,day:sim.days,initiative:orderIds,events});return {simulation:sim,ownership:saved};
}
function rollAverage(s){const m=/^(\d+)d(\d+)([+-]\d+)?$/i.exec(s||'');return m?+m[1]*(+m[2]+1)/2+Number(m[3]||0):0;}
export function addGMAsset(sim,id,template,locationId,hp){if(!sim.factions[id])throw Error('Choose a faction.');return newAsset(sim,id,template,locationId,hp);}
export function upgradeRating(sim,id,stat){const f=sim.factions[id];if(!stats.includes(stat)||!f||f[stat]>=8)throw Error('Rating cannot increase.');if(f.upgrades?.[stat]===sim.turn)throw Error('This rating has already increased this turn.');const cost=RATING_XP[f[stat]+1];if(f.xp<cost)throw Error(`Requires ${cost} XP.`);const before=maxHP(f);f.xp-=cost;f[stat]++;f.hp+=maxHP(f)-before;f.upgrades||={};f.upgrades[stat]=sim.turn;}
// Imported campaign metadata is data, never markup or executable rules.
export function validateSimulationState(sim){
 if(sim===undefined||sim===null)return;
 const fail=()=>{throw Error('This map contains invalid or unsupported faction simulation data. Use a valid Drift Atlas export.');};
 const obj=v=>v&&typeof v==='object'&&!Array.isArray(v),num=(v,min=0,max=1e9)=>Number.isSafeInteger(v)&&v>=min&&v<=max,str=v=>typeof v==='string'&&v.length<10000;
 if(!obj(sim)||sim.version!==1||!str(sim.id)||!num(sim.turn)||!num(sim.days)||!num(sim.turnDays,1,365)||!num(sim.seed,0,4294967295)||!num(sim.nextAsset,1)||!['auto','manual'].includes(sim.mode)||!obj(sim.factions)||!Array.isArray(sim.assets)||!Array.isArray(sim.history)||!obj(sim.orders))fail();
 for(const [id,f] of Object.entries(sim.factions)){if(!obj(f)||!str(id)||!str(f.name)||!stats.every(k=>num(f[k],1,8))||!num(f.hp,0,maxHP(f))||!num(f.credits)||!num(f.xp)||!obj(f.relations)||!['auto','manual'].includes(f.control)||!['expansionist','aggressive','mercantile','cautious'].includes(f.style)||!str(f.tag)||!(f.home===null||str(f.home)))fail();if(f.goal&&(!obj(f.goal)||!str(f.goal.type)||!num(f.goal.progress)||!num(f.goal.target,1)||!num(f.goal.reward,1,20)))fail();if(f.seizing&&(!str(f.seizing.locationId)||!num(f.seizing.hold,0,3)))fail();if(f.relocating&&(!str(f.relocating.locationId)||!num(f.relocating.remaining)))fail();}
 const ids=new Set();for(const a of sim.assets){if(!obj(a)||!str(a.id)||ids.has(a.id)||!sim.factions[a.factionId]||!str(a.locationId)||!(a.template==='base'||ASSET_BY_ID[a.template])||!num(a.maxHp,1,10000)||!num(a.hp,0,a.maxHp)||!num(a.readyTurn)||!num(a.arrears||0,0,2))fail();ids.add(a.id);}
 if(sim.incomeModel!==undefined&&!['territory','standard'].includes(sim.incomeModel))fail();
 if(sim.initializedHoldings!==undefined&&(!obj(sim.initializedHoldings)||Object.entries(sim.initializedHoldings).some(([id,v])=>!str(id)||v!==true)))fail();
 for(const r of sim.history)if(!obj(r)||!num(r.turn)||!num(r.day)||!Array.isArray(r.events)||r.events.some(e=>!obj(e)||!str(e.text)))fail();
 for(const [id,o] of Object.entries(sim.orders))if(!sim.factions[id]||!obj(o)||!str(o.action))fail();
 if(sim.undo){if(!obj(sim.undo)||sim.undo.simulation?.undo||!Array.isArray(sim.undo.changes))fail();validateSimulationState(sim.undo.simulation);}
}
