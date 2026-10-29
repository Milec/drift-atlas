import test from 'node:test';
import assert from 'node:assert/strict';
import {freshSimulation,syncParticipants,buildWorld,maxHP,economy,advanceTurn,validateOrder,addGMAsset,previewOrders,planControlledAssets,populateControlledAssets,validateSimulationState,definition} from '../dist/simulation.js';
import {prepareSector,createCluster,composeCluster,extractSector,syncCluster,mapId} from '../dist/clusters.js';
function fixture(){const data={sector:{sector:{name:'Fixture',columns:8,rows:10}},system:{s1:{name:'One',x:1,y:1},s2:{name:'Two',x:5,y:2},s3:{name:'Isolated',x:8,y:8}},planet:{p1:{name:'Home',parent:'s1',parentEntity:'system',attributes:{techLevel:'TL4'}},p2:{name:'Frontier',parent:'s2',parentEntity:'system',attributes:{techLevel:'TL0'}},p3:{name:'Rival',parent:'s3',parentEntity:'system',attributes:{techLevel:'TL4'}}},spaceStation:{station:{name:'Orbital',parent:'s1',parentEntity:'system'}},_driftAtlas:{version:1,factions:{a:{name:'Republic',color:'#79dbcf'},b:{name:'Empire',color:'#cc3333'}},systems:{p1:{factionId:'a'},p3:{factionId:'b'}},lanes:[['s1','s2']]}};const saved=structuredClone(data._driftAtlas.systems),world=buildWorld(data),sim=freshSimulation(123);// Keep the turn-engine baseline at the legacy capital-only setup; new initialization is tested separately.
 for(const [id,home,ratings] of [['a','p1',[3,2,1]],['b','p3',[1,3,2]]]){const f={id,name:data._driftAtlas.factions[id].name,force:ratings[0],cunning:ratings[1],wealth:ratings[2],credits:8,xp:0,home,style:id==='a'?'expansionist':'aggressive',control:'auto',tag:'',relations:{},goal:{type:'expand',progress:0,target:1,reward:1},seizing:null,absorbs:false};f.hp=maxHP(f);sim.factions[id]=f;addGMAsset(sim,id,'base',home,f.hp);for(const t of ['security-personnel','harvesters','smugglers'])addGMAsset(sim,id,t,home);}
 sim.mode='manual';sim.incomeModel='standard';return {data,saved,world,sim};}
test('ratings, income and numerical catalog are SWN-based',()=>{const {sim}=fixture();assert.equal(maxHP(sim.factions.a),11);assert.equal(economy(sim,'a').base,2);assert.equal(economy(sim,'a').over,0);assert.equal(sim.assets.length,8);});
test('advance is pure and replayable; undo carries exact prior dice state',()=>{const {sim,world,saved}=fixture(),original=structuredClone(sim);const x=advanceTurn(sim,world,saved),y=advanceTurn(sim,world,saved);assert.deepEqual(x,y);assert.deepEqual(sim,original);assert.equal(x.simulation.turn,1);assert.equal(x.simulation.days,30);assert.equal(x.simulation.undo.simulation.seed,123);assert.deepEqual(advanceTurn(x.simulation.undo.simulation,world,saved),x);});
test('purchases enforce attributes, tech, home/base and permission; become ready next turn',()=>{const {sim,world,saved}=fixture();assert.match(validateOrder(sim,'a',{action:'buy',template:'capital-fleet',locationId:'p1'},world,saved),/rating/);assert.match(validateOrder(sim,'a',{action:'buy',template:'security-personnel',locationId:'p2'},world,saved),/home/);sim.factions.a.home='p2';assert.match(validateOrder(sim,'a',{action:'buy',template:'militia-unit',locationId:'p2'},world,saved),/technology/);sim.factions.a.home='p1';sim.orders.a={action:'buy',template:'security-personnel',locationId:'p1'};const x=advanceTurn(sim,world,saved).simulation;assert.equal(x.assets.at(-1).readyTurn,2);assert.equal(x.factions.a.credits,8);});
test('movement uses lane topology and transport restrictions',()=>{const {sim,world,saved}=fixture(),a=sim.assets.find(a=>a.factionId==='a'&&a.template==='smugglers');assert.equal(world.jumps('p1','station'),0);assert.equal(world.jumps('p1','p2'),1);assert.equal(world.jumps('p1','p3'),Infinity);assert.equal(validateOrder(sim,'a',{action:'move',assetId:a.id,locationId:'p2'},world,saved),'');assert.match(validateOrder(sim,'a',{action:'move',assetId:a.id,locationId:'p3'},world,saved),/range/);const base=sim.assets.find(a=>a.factionId==='a'&&a.template==='base');assert.match(validateOrder(sim,'a',{action:'move',assetId:a.id,cargoId:base.id,locationId:'p2'},world,saved),/transport/);});
test('three-turn seizure changes only the selected orbital and records undo delta',()=>{const {sim,world,saved}=fixture();sim.assets.find(a=>a.factionId==='a'&&a.template==='security-personnel').locationId='station';sim.orders.a={action:'seize',locationId:'station'};let result=advanceTurn(sim,world,saved);assert.equal(result.ownership.station,undefined);result=advanceTurn(result.simulation,world,result.ownership);assert.equal(result.ownership.station,undefined);result=advanceTurn(result.simulation,world,result.ownership);assert.equal(result.ownership.station.factionId,'a');assert.equal(result.ownership.p3.factionId,'b');assert.deepEqual(result.simulation.undo.changes,[{id:'station',before:undefined,after:'a'}]);});
test('base damage also damages faction, with no overflow beyond base HP',()=>{const {sim,world,saved}=fixture();sim.assets=[];const attacker=addGMAsset(sim,'a','gravtank-formation','station'),base=addGMAsset(sim,'b','base','station',1);sim.factions.a.force=8;sim.factions.b.force=1;const oldHP=sim.factions.b.hp;sim.orders.a={action:'attack',locationId:'station',targetFaction:'b'};const result=advanceTurn(sim,world,saved);assert.equal(result.simulation.factions.b.hp,oldHP-1);assert.ok(!result.simulation.assets.some(a=>a.id===base.id));assert.ok(result.simulation.history.at(-1).events.some(e=>e.text.includes('d10')));});
test('combat ties inflict both attack and counter damage',()=>{let found=false;for(let seed=1;seed<500&&!found;seed++){const {sim,world,saved}=fixture();sim.seed=seed;sim.assets=[];sim.factions.a.force=sim.factions.b.force=3;const a=addGMAsset(sim,'a','security-personnel','station'),b=addGMAsset(sim,'b','security-personnel','station');a.hp=a.maxHp=b.hp=b.maxHp=50;sim.orders.a={action:'attack',locationId:'station',targetFaction:'b'};const result=advanceTurn(sim,world,saved),report=result.simulation.history.at(-1).events.find(e=>e.text.includes('defense'));if(!report)continue;const m=/= (\d+); defense .* = (\d+)/.exec(report.text);if(m&&m[1]===m[2]){assert.ok(result.simulation.assets.find(x=>x.id===a.id).hp<50);assert.ok(result.simulation.assets.find(x=>x.id===b.id).hp<50);found=true;}}assert.ok(found,'A deterministic tie case was tested');});
test('unpaid upkeep disables then removes an asset; credits never go negative',()=>{const {sim,world,saved}=fixture();sim.factions.a.credits=0;for(let i=0;i<10;i++)addGMAsset(sim,'a','security-personnel','p1');const fleet=addGMAsset(sim,'a','capital-fleet','p1');let r=advanceTurn(sim,world,saved);assert.equal(r.simulation.assets.find(a=>a.id===fleet.id).arrears,1);r=advanceTurn(r.simulation,world,r.ownership);assert.ok(!r.simulation.assets.some(a=>a.id===fleet.id));assert.equal(r.simulation.factions.a.credits,0);});
test('partial repairs follow rising cost and do not exceed maximum HP',()=>{const {sim,world,saved}=fixture(),a=sim.assets.find(a=>a.factionId==='a'&&a.template==='security-personnel');a.hp=1;sim.orders.a={action:'repair',assetId:a.id,amount:2};const r=advanceTurn(sim,world,saved);assert.equal(r.simulation.assets.find(x=>x.id===a.id).hp,3);assert.equal(r.simulation.factions.a.credits,7);});
test('preview is side-effect free and auto simulation advances many turns without invalid state',()=>{let {sim,world,saved}=fixture();sim.mode='auto';const original=structuredClone(sim);previewOrders(sim,world,saved);assert.deepEqual(sim,original);for(let i=0;i<50;i++){const r=advanceTurn(sim,world,saved);sim=r.simulation;saved=r.ownership;for(const f of Object.values(sim.factions)){assert.ok(Number.isFinite(f.credits)&&f.credits>=0);assert.ok(Number.isFinite(f.hp)&&f.hp>=0&&f.hp<=maxHP(f));}for(const a of sim.assets)assert.ok(a.hp>0&&a.hp<=a.maxHp);}assert.equal(sim.history.length,50);assert.ok(Object.values(saved).filter(e=>e.factionId).length>2);});
test('simulation survives cluster conversion, movement, save/reload and member extraction',()=>{const {data,sim,saved}=fixture();data._driftAtlas.simulation=sim;data._driftAtlas.systems=saved;const cluster=createCluster(data),m=cluster._driftAtlasCluster.members[0];assert.equal(cluster._driftAtlas.simulation.assets.length,sim.assets.length);assert.equal(cluster._driftAtlas.simulation.factions.a.home,mapId(m.id,'p1'));cluster._driftAtlas.simulation.factions.a.credits=37;cluster._driftAtlas.simulation.turn=9;syncCluster(cluster);const reload=composeCluster(cluster._driftAtlasCluster);assert.equal(reload._driftAtlas.simulation.factions.a.credits,37);assert.equal(reload._driftAtlas.simulation.turn,9);reload._driftAtlasCluster.members[0].x=20;const moved=composeCluster(reload._driftAtlasCluster);assert.equal(moved._driftAtlas.simulation.assets.length,sim.assets.length);const single=extractSector(moved,m.id);assert.equal(single._driftAtlas.simulation.factions.a.home,'p1');assert.ok(single._driftAtlas.simulation.assets.every(a=>['p1','p3'].includes(a.locationId)));assert.equal(single._driftAtlas.simulation.factions.a.credits,37);});
test('adding a second simulated sector retains existing finances and namespaces its assets',()=>{const {data,sim}=fixture();data._driftAtlas.simulation=sim;let cluster=createCluster(data);cluster._driftAtlas.simulation.factions.a.credits=99;syncCluster(cluster);const meta=cluster._driftAtlasCluster;meta.members.push({id:'extra',x:15,y:0,sector:prepareSector(data)});cluster=composeCluster(meta);assert.equal(cluster._driftAtlas.simulation.factions.a.credits,99);assert.equal(cluster._driftAtlas.simulation.assets.length,sim.assets.length*2);assert.equal(new Set(cluster._driftAtlas.simulation.assets.map(a=>a.id)).size,sim.assets.length*2);});
test('queued orders survive sector-to-cluster conversion and extraction',()=>{const {data,sim}=fixture();sim.orders.a={action:'buy',template:'security-personnel',locationId:'p1'};data._driftAtlas.simulation=sim;const cluster=createCluster(data),m=cluster._driftAtlasCluster.members[0];assert.equal(cluster._driftAtlas.simulation.orders.a.locationId,mapId(m.id,'p1'));const single=extractSector(cluster,m.id);assert.deepEqual(single._driftAtlas.simulation.orders.a,sim.orders.a);});
test('deleted factions are archived and cannot take invisible turns',()=>{const {data,sim,world,saved}=fixture();delete data._driftAtlas.factions.a;syncParticipants(sim,data,saved);const result=advanceTurn(sim,world,saved);assert.ok(!result.simulation.history.at(-1).initiative.includes('a'));assert.equal(result.simulation.factions.a.credits,8);});
test('simulation validation rejects unsafe or unsupported imported fields',async()=>{const {validateSimulationState}=await import('../dist/simulation.js');const {sim,world,saved}=fixture();assert.doesNotThrow(()=>validateSimulationState(sim));assert.doesNotThrow(()=>validateSimulationState(advanceTurn(sim,world,saved).simulation));const bad=structuredClone(sim);bad.factions.a.hp='<img src=x onerror=alert(1)>';assert.throws(()=>validateSimulationState(bad),/invalid/);bad.factions.a.hp=2;bad.assets[0].template='missing';assert.throws(()=>validateSimulationState(bad),/invalid/);});
test('a newly expanded base registers for purchases on the following turn',()=>{
 const {sim,world,saved}=fixture();
 sim.assets.find(a=>a.factionId==='a'&&a.template==='security-personnel').locationId='station';
 sim.orders.a={action:'expand',locationId:'station',hp:2};
 const expanded=advanceTurn(sim,world,saved).simulation;
 const order={action:'buy',template:'security-personnel',locationId:'station'};
 assert.equal(validateOrder(expanded,'a',order,world,saved),'');
 expanded.orders.a=order;
 const result=advanceTurn(expanded,world,saved).simulation;
 assert.ok(result.assets.some(a=>a.template==='security-personnel'&&a.locationId==='station'&&a.readyTurn===3));
});
test('planning clears affordable upkeep arrears and matches automatic turn execution',()=>{
 const {sim,world,saved}=fixture();sim.mode='auto';
 sim.assets=sim.assets.filter(a=>a.factionId!=='a');
 const fleet=addGMAsset(sim,'a','capital-fleet','p1');fleet.arrears=1;
 sim.factions.a.credits=10;
 const order={action:'move',assetId:fleet.id,locationId:'station'};
 const original=structuredClone(sim);
 assert.equal(validateOrder(sim,'a',order,world,saved),'');
 const plan=previewOrders(sim,world,saved).a;
 assert.equal(plan.action,'expand');
 assert.deepEqual(sim,original);
 const result=advanceTurn(sim,world,saved).simulation;
 assert.ok(result.history.at(-1).events.some(e=>e.factionId==='a'&&e.text.startsWith('Order: '+plan.action)));
 assert.equal(result.assets.find(a=>a.id===fleet.id).arrears,0);
});
test('planning rejects assets that cannot pay upcoming upkeep',()=>{
 const {sim,world,saved}=fixture();sim.factions.a.credits=0;
 for(let i=0;i<10;i++)addGMAsset(sim,'a','security-personnel','p1');
 const fleet=addGMAsset(sim,'a','capital-fleet','p1');
 assert.match(validateOrder(sim,'a',{action:'move',assetId:fleet.id,locationId:'station'},world,saved),/active/);
});
test('asset income starts on its ready turn, never a turn early',()=>{
 const {sim,world,saved}=fixture();sim.assets=sim.assets.filter(a=>a.factionId!=='a');
 const party=addGMAsset(sim,'a','party-machine','p1');party.readyTurn=2;
 const first=advanceTurn(sim,world,saved).simulation;
 assert.equal(first.factions.a.credits,10);
 const second=advanceTurn(first,world,saved).simulation;
 assert.equal(second.factions.a.credits,13);
});

function developedFixture(){
 const {data,saved}=fixture();
 data.planet.p1.attributes.population='Billions of inhabitants';
 data.planet.p2.attributes.population='Millions of inhabitants';
 data.planet.p3.attributes.population='Hundreds of millions of inhabitants';
 data.planet.empty={name:'Vacant',parent:'s2',attributes:{techLevel:'TL4',population:'Uninhabited'}};
 data.planet.pretech={name:'Arcology',parent:'s2',attributes:{techLevel:'TL5',population:'10 billion'}};
 data.researchBase={lab:{name:'Institute',parent:'p1'}};
 data.gasGiantMine={mine:{name:'Extraction',parent:'p1'}};
 data.refuelingStation={fuel:{name:'Fuel depot',parent:'p1'}};
 data.moon={moon:{name:'Rival moon',parent:'p1',attributes:{techLevel:'TL2',population:2000}}};
 for(const id of ['p2','station','empty','lab','mine','fuel','pretech'])saved[id]={factionId:'a'};
 saved.moon={factionId:'b'};
 data._driftAtlas.systems=saved;
 return {data,saved,world:buildWorld(data)};
}
test('fresh setup populates every controlled orbital, with capitals strongest and technology respected',()=>{
 const {data,saved,world}=developedFixture(),sim=freshSimulation(456),before=structuredClone(saved);
 syncParticipants(sim,data,saved);
 for(const [loc,edit] of Object.entries(saved)){
  const assets=sim.assets.filter(a=>a.locationId===loc);
  assert.ok(assets.some(a=>a.template==='base'&&a.factionId===edit.factionId),loc);
  assert.ok(assets.some(a=>a.template!=='base'&&a.factionId===edit.factionId),loc);
  for(const a of assets.filter(a=>a.template!=='base')){const d=definition(a);assert.ok(d.tl<=world.byId.get(loc).tl);assert.ok(d.level<=sim.factions[a.factionId][d.stat]);}
 }
 const f=sim.factions.a,capital=sim.assets.filter(a=>a.locationId===f.home);
 assert.equal(f.home,'pretech');
 assert.equal(capital.find(a=>a.template==='base').maxHp,maxHP(f));
 for(const l of world.locations.filter(l=>saved[l.id]?.factionId==='a'&&l.id!==f.home))assert.ok(sim.assets.filter(a=>a.locationId===l.id).length<capital.length);
 assert.deepEqual(saved,before);
 assert.doesNotThrow(()=>validateSimulationState(sim));
});
test('population, technology and facility type produce distinct local packages',()=>{
 const {data,saved,world}=developedFixture(),sim=freshSimulation(456);syncParticipants(sim,data,saved);
 const at=id=>sim.assets.filter(a=>a.locationId===id).map(a=>a.template);
 assert.ok(at('lab').includes('pretech-researchers'));
 assert.ok(at('mine').includes('postech-industry'));
 assert.ok(at('fuel').includes('shipping-combine'));
 assert.ok(at('pretech').includes('pretech-manufactory'));
 assert.ok(at('p2').includes('security-personnel'));
 assert.equal(at('empty').length,2); // base + small survey outpost
 assert.ok(at('empty').includes('surveyors'));
 assert.ok(at('p1').length>at('empty').length);
 assert.ok(!sim.assets.some(a=>!saved[a.locationId]));
});
test('existing campaigns get a pure preview and additive initialization without changing profiles or orders',()=>{
 const {sim}=fixture(),{world,saved}=developedFixture();sim.turn=12;sim.days=360;sim.factions.a.hp=7;sim.factions.a.credits=23;sim.orders.a={action:'use',assetId:sim.assets.find(a=>a.template==='harvesters').id};
 const before=structuredClone(sim),plan=planControlledAssets(sim,world,saved);
 assert.deepEqual(sim,before);
 assert.ok(plan.assets.some(a=>a.locationId==='station'));
 const result=populateControlledAssets(sim,world,saved);
 assert.equal(sim.assets.length,before.assets.length+plan.assets.length);
 assert.deepEqual(sim.factions,before.factions);
 assert.deepEqual(sim.orders,before.orders);
 for(const asset of before.assets)assert.deepEqual(sim.assets.find(a=>a.id===asset.id),asset);
 assert.equal(sim.turn,12);assert.equal(sim.days,360);assert.equal(sim.seed,before.seed);
 assert.equal(result.locations.length,plan.locations.length);
 assert.doesNotThrow(()=>validateSimulationState(sim));
});
test('initialization is idempotent and never replenishes casualties, sold assets, moved units or captured holdings',()=>{
 const {data,saved,world}=developedFixture(),sim=freshSimulation();syncParticipants(sim,data,saved);
 const count=sim.assets.length;
 assert.equal(populateControlledAssets(sim,world,saved).assets.length,0);
 const victim=sim.assets.find(a=>a.locationId==='station'&&a.template!=='base');sim.assets=sim.assets.filter(a=>a.id!==victim.id);
 const moved=sim.assets.find(a=>a.locationId==='mine'&&a.template!=='base');moved.locationId='fuel';
 saved.station.factionId='b';
 syncParticipants(sim,data,saved);populateControlledAssets(sim,world,saved);
 assert.equal(sim.assets.length,count-1);
 assert.equal(sim.assets.find(a=>a.id===moved.id).locationId,'fuel');
 assert.equal(planControlledAssets(sim,world,saved).locations.length,0);
});
test('unclaimed, archived and defeated locations are not populated; turn advancement grants no free occupation assets',()=>{
 const {sim,world,saved,data}=fixture();delete saved.p3;sim.factions.b.hp=0;
 const plan=populateControlledAssets(sim,world,saved);assert.ok(plan.locations.every(l=>l.locationId==='p1'));
 saved.station={factionId:'a'};const before=sim.assets.length;
 syncParticipants(sim,data,saved);assert.equal(sim.assets.length,before);
 const result=advanceTurn(sim,world,saved);assert.equal(result.simulation.assets.length,before);
 assert.ok(planControlledAssets(sim,world,saved).locations.some(l=>l.locationId==='station'));
});
test('optional scaling meets template requirements, preserves damage and previews overextension',()=>{
 const {sim}=fixture(),{world,saved}=developedFixture();sim.factions.a.hp-=3;
 const oldDamage=maxHP(sim.factions.a)-sim.factions.a.hp;
 const plan=planControlledAssets(sim,world,saved,{scaleRatings:true});populateControlledAssets(sim,world,saved,{scaleRatings:true});
 assert.equal(maxHP(sim.factions.a)-sim.factions.a.hp,oldDamage);
 assert.deepEqual(economy(sim,'a'),plan.economies.a.after);
 for(const a of sim.assets.filter(a=>a.template!=='base'))assert.ok(definition(a).level<=sim.factions[a.factionId][definition(a).stat]);
 assert.ok(sim.factions.a.credits>=8+3*Math.max(0,-economy(sim,'a').net));
});
test('initialized holdings survive cluster merges, movement, extraction, export and reload without duplication',()=>{
 const {data,saved,world}=developedFixture(),sim=freshSimulation();syncParticipants(sim,data,saved);data._driftAtlas.simulation=sim;
 let cluster=createCluster(data);const meta=cluster._driftAtlasCluster,first=meta.members[0].id;
 syncCluster(cluster);meta.members.push({id:'second',x:20,y:0,sector:prepareSector(data)});cluster=composeCluster(meta);
 assert.equal(Object.keys(cluster._driftAtlas.simulation.initializedHoldings).length,Object.keys(sim.initializedHoldings).length*2);
 assert.equal(planControlledAssets(cluster._driftAtlas.simulation,buildWorld(cluster),cluster._driftAtlas.systems).assets.length,0);
 cluster._driftAtlasCluster.members[0].x=40;syncCluster(cluster);cluster=composeCluster(JSON.parse(JSON.stringify(cluster._driftAtlasCluster)));
 const single=extractSector(cluster,first);assert.deepEqual(single._driftAtlas.simulation.initializedHoldings,sim.initializedHoldings);
 assert.doesNotThrow(()=>validateSimulationState(cluster._driftAtlas.simulation));
 assert.equal(planControlledAssets(single._driftAtlas.simulation,buildWorld(single),single._driftAtlas.systems).assets.length,0);
});

test('territorial income scales with population and technology; barren locations yield zero',async()=>{
 const {locationIncome}=await import('../dist/sim-income.js');
 const world=(population,tl,type='planet')=>locationIncome({type,tl,attributes:{population}}).credits;
 assert.equal(world(0,5),0);assert.equal(world('Uninhabited',4),0);
 assert.equal(world(1000,4),1);assert.equal(world(100000,4),2);assert.equal(world(1e8,4),3);assert.equal(world('Billions of inhabitants',4),4);
 assert.equal(world(1e9,0),1);assert.equal(world(1e9,2),2);assert.equal(world(1e9,3),3);assert.equal(world(1e9,5),5);
 assert.equal(world(undefined,4),1);assert.equal(world(undefined,4,'moon'),0);
 for(const type of ['system','blackHole','asteroidBelt','orbitalRuin'])assert.equal(locationIncome({type,tl:5}).credits,0);
 assert.equal(locationIncome({type:'spaceStation',tl:4}).credits,3);
 assert.equal(locationIncome({type:'gasGiantMine',tl:2}).credits,2);
 assert.equal(locationIncome({type:'researchBase',tl:4}).credits,3);
 assert.equal(locationIncome({type:'moonBase',tl:4}).credits,2);
 assert.equal(locationIncome({type:'spaceStation',tl:4,attributes:{occupation:'Abandoned'}}).credits,0);
});
test('territory pays only the orbital owner, with one productive owned capital bonus and no asset stacking',()=>{
 const {sim,world,saved}=fixture();sim.incomeModel='territory';saved.station={factionId:'b'};saved.s1={factionId:'a'};
 const a=economy(sim,'a',{world,saved}),b=economy(sim,'b',{world,saved});
 assert.equal(a.territory,2);assert.equal(b.territory,5);
 for(let i=0;i<5;i++)addGMAsset(sim,'a','base','station',1);
 assert.equal(economy(sim,'a',{world,saved}).territory,a.territory);
 assert.equal(economy(sim,'b',{world,saved}).territory,b.territory);
 saved.p1.factionId='b';assert.equal(economy(sim,'a',{world,saved}).territory,0);
 assert.equal(economy(sim,'b',{world,saved}).territory,b.territory+1);
});
test('territorial income funds next-turn queued orders and matches actual credit resolution',()=>{
 const {sim,world,saved}=fixture();sim.incomeModel='territory';sim.factions.a.wealth=3;sim.factions.a.credits=0;saved.station={factionId:'a'};
 const order={action:'buy',template:'postech-industry',locationId:'p1'}; // 8 credits: base 3 + world/capital 2 + station 3
 assert.equal(economy(sim,'a',{world,saved}).net,8);
 assert.equal(validateOrder(sim,'a',order,world,saved),'');
 const old=structuredClone(sim);sim.orders.a=order;assert.deepEqual(previewOrders(sim,world,saved).a,order);
 const result=advanceTurn(sim,world,saved).simulation;
 assert.equal(result.factions.a.credits,0);assert.ok(result.assets.some(a=>a.template==='postech-industry'));
 assert.equal(sim.factions.a.credits,old.factions.a.credits);
 const standard=structuredClone(sim);standard.incomeModel='standard';assert.match(validateOrder(standard,'a',order,world,saved),/credits/);
});
test('a capture changes territory income next turn, and undo/replay restores exact balances',()=>{
 const {sim,world,saved}=fixture();sim.incomeModel='territory';sim.assets.find(a=>a.factionId==='a'&&a.template==='security-personnel').locationId='station';
 saved.station={factionId:'b'};sim.factions.a.seizing={locationId:'station',hold:2};sim.orders.a={action:'seize',locationId:'station'};
 const expected=economy(sim,'a',{world,saved}).net;
 const first=advanceTurn(sim,world,saved);assert.equal(first.ownership.station.factionId,'a');assert.equal(first.simulation.factions.b.credits,sim.factions.b.credits+economy(sim,'b',{world,saved}).net);assert.equal(first.simulation.factions.a.credits,sim.factions.a.credits+expected);
 assert.deepEqual(advanceTurn(first.simulation.undo.simulation,world,saved),first);
 const next=economy(first.simulation,'a',{world,saved:first.ownership});assert.equal(next.territory,5);
 const second=advanceTurn(first.simulation,world,first.ownership);
 assert.equal(second.simulation.factions.a.credits,first.simulation.factions.a.credits+next.net);
});
test('existing saves gain territory income without reset; standard mode retains SWN costs and formula',()=>{
 const {sim,world,saved}=fixture();delete sim.incomeModel;const before=structuredClone(sim);
 const e=economy(sim,'a',{world,saved});assert.equal(e.territory,2);assert.deepEqual(sim,before);
 const standard=structuredClone(sim);standard.incomeModel='standard';const plain=economy(standard,'a',{world,saved});
 for(const key of ['base','over','upkeep','bonus','counts'])assert.deepEqual(e[key],plain[key]);
 assert.equal(e.net-plain.net,e.territory);assert.equal(plain.territory,0);
 assert.doesNotThrow(()=>validateSimulationState(sim));sim.incomeModel='bad';assert.throws(()=>validateSimulationState(sim));
});
test('income uses only remaining cluster members and persists its rule choice through save/extraction',()=>{
 const {data,sim}=fixture();sim.incomeModel='territory';data._driftAtlas.simulation=sim;
 let cluster=createCluster(data);syncCluster(cluster);const meta=cluster._driftAtlasCluster,first=meta.members[0].id;
 meta.members.push({id:'extra-income',x:20,y:0,sector:prepareSector(data)});cluster=composeCluster(meta);
 const income=d=>economy(d._driftAtlas.simulation,'a',{world:buildWorld(d),saved:d._driftAtlas.systems}).territory;
 assert.equal(income(cluster),3); // two distinct worlds; one faction capital
 const single=extractSector(cluster,first);assert.equal(income(single),2);assert.equal(single._driftAtlas.simulation.incomeModel,'territory');
 cluster._driftAtlas.simulation.incomeModel='standard';syncCluster(cluster);cluster=composeCluster(JSON.parse(JSON.stringify(cluster._driftAtlasCluster)));assert.equal(income(cluster),0);
 cluster._driftAtlas.simulation.incomeModel='territory';syncCluster(cluster);cluster._driftAtlasCluster.members=cluster._driftAtlasCluster.members.filter(m=>m.id===first);cluster=composeCluster(cluster._driftAtlasCluster);assert.equal(income(cluster),2);
});
test('large developed sectors and clusters sustain their starting roster while excess fleets still cost money',async()=>{
 const {readFileSync}=await import('node:fs');const data=JSON.parse(readFileSync(new URL('../dist/sector.json',import.meta.url)));
 const world=buildWorld(data),saved={};data._driftAtlas||={};data._driftAtlas.factions={a:{name:'Senate',color:'#79dbcf'},b:{name:'League',color:'#cc3333'}};
 world.locations.forEach((l,i)=>saved[l.id]={factionId:i%2?'a':'b'});data._driftAtlas.systems=saved;
 let sim=freshSimulation(123);syncParticipants(sim,data,saved);sim.mode='manual';data._driftAtlas.simulation=sim;
 let cluster=createCluster(data);syncCluster(cluster);for(let i=1;i<4;i++)cluster._driftAtlasCluster.members.push({id:'income-sector-'+i,x:20*i,y:0,sector:prepareSector(data)});cluster=composeCluster(cluster._driftAtlasCluster);
 for(const d of [data,cluster]){
  let s=d._driftAtlas.simulation;const w=buildWorld(d),claims=d._driftAtlas.systems,initial=s.assets.length;
  for(const id of ['a','b']){const e=economy(s,id,{world:w,saved:claims});assert.ok(e.net>0);assert.ok(e.net<80,'The surplus remains bounded for this four-sector fixture');}
  for(let i=0;i<6;i++){s=advanceTurn(s,w,claims).simulation;validateSimulationState(s);}
  assert.equal(s.assets.length,initial);assert.ok(s.assets.every(a=>!a.arrears));
  const prior=economy(s,'a',{world:w,saved:claims});addGMAsset(s,'a','capital-fleet',s.factions.a.home);const after=economy(s,'a',{world:w,saved:claims});
  assert.equal(after.territory,prior.territory);assert.equal(after.net,prior.net-3); // overextension + 2 upkeep
 }
});

test('multiple-turn advancement exactly matches sequential automatic turns and preserves its input',async()=>{
 const {advanceTurns}=await import('../dist/sim-batch.js');const {sim,world,saved}=fixture();sim.mode='auto';sim.incomeModel='territory';
 const original=structuredClone(sim),ownership=structuredClone(saved),progress=[];
 let sequential={simulation:sim,ownership:saved};for(let i=0;i<12;i++)sequential=advanceTurn(sequential.simulation,world,sequential.ownership);
 const batch=await advanceTurns(sim,world,saved,12,{onProgress:n=>progress.push(n),yieldControl:async()=>{}});
 assert.equal(batch.completed,12);assert.deepEqual({...batch.simulation,undo:null},{...sequential.simulation,undo:null});assert.deepEqual(batch.ownership,sequential.ownership);
 assert.deepEqual(progress,Array.from({length:13},(_,i)=>i));assert.deepEqual(sim,original);assert.deepEqual(saved,ownership);
 assert.equal(batch.simulation.undo.simulation.turn,sim.turn);assert.equal(batch.simulation.undo.simulation.seed,sim.seed);validateSimulationState(batch.simulation);
 const replay=await advanceTurns(batch.simulation.undo.simulation,world,saved,12,{yieldControl:async()=>{}});assert.deepEqual(replay,batch);
});
test('single-turn runs retain normal results and queued manual orders execute only once in a batch',async()=>{
 const {advanceTurns}=await import('../dist/sim-batch.js');const {sim,world,saved}=fixture();sim.orders.a={action:'buy',template:'security-personnel',locationId:'p1'};
 const single=await advanceTurns(sim,world,saved,1,{yieldControl:async()=>{}});assert.deepEqual({simulation:single.simulation,ownership:single.ownership},advanceTurn(sim,world,saved));
 const batch=await advanceTurns(sim,world,saved,5,{yieldControl:async()=>{}});
 assert.equal(batch.simulation.assets.length,sim.assets.length+1);
 assert.equal(batch.simulation.history.flatMap(r=>r.events).filter(e=>e.factionId==='a'&&e.text.startsWith('Order: buy')).length,1);
 assert.equal(batch.simulation.days,sim.days+5*sim.turnDays);assert.equal(batch.simulation.history.length,5);
});
test('batch occupation, subsequent income and whole-run ownership undo stay consistent',async()=>{
 const {advanceTurns}=await import('../dist/sim-batch.js');const {sim,world,saved}=fixture();sim.incomeModel='territory';
 sim.assets.find(a=>a.factionId==='a'&&a.template==='security-personnel').locationId='station';sim.orders.a={action:'seize',locationId:'station'};
 const batch=await advanceTurns(sim,world,saved,4,{yieldControl:async()=>{}});
 assert.equal(batch.ownership.station.factionId,'a');assert.equal(batch.simulation.factions.a.seizing,null);
 assert.deepEqual(batch.simulation.undo.changes,[{id:'station',before:undefined,after:'a'}]);
 assert.ok(batch.simulation.history[3].events.some(e=>e.factionId==='a'&&e.text.includes('+ 5 territory')));
 assert.deepEqual(batch.simulation.undo.simulation.assets,sim.assets);
});
test('stopping a batch commits complete turns only and undo covers all completed turns',async()=>{
 const {advanceTurns}=await import('../dist/sim-batch.js');const {sim,world,saved}=fixture();let completed=0;
 const batch=await advanceTurns(sim,world,saved,10,{onProgress:n=>{completed=n;},shouldStop:()=>completed===3,yieldControl:async()=>{}});
 assert.equal(batch.completed,3);assert.equal(batch.simulation.turn,3);assert.equal(batch.simulation.history.length,3);assert.equal(batch.simulation.undo.simulation.turn,0);
 const stopped=await advanceTurns(batch.simulation,world,batch.ownership,10,{shouldStop:()=>true,yieldControl:async()=>{}});
 assert.equal(stopped.completed,0);assert.deepEqual(stopped.simulation,batch.simulation);assert.deepEqual(stopped.ownership,batch.ownership);
});
test('invalid batch sizes are rejected before changing a campaign',async()=>{
 const {advanceTurns,MAX_BATCH_TURNS}=await import('../dist/sim-batch.js');const {sim,world,saved}=fixture(),before=structuredClone(sim);
 for(const count of [0,-1,1.5,NaN,Infinity,MAX_BATCH_TURNS+1,'5'])await assert.rejects(advanceTurns(sim,world,saved,count),/whole number/);
 assert.deepEqual(sim,before);
});
test('a full batch persists with its undo and history in a cluster save',async()=>{
 const {advanceTurns,MAX_BATCH_TURNS}=await import('../dist/sim-batch.js');const {data,sim}=fixture();data._driftAtlas.simulation=sim;
 let cluster=createCluster(data);const before=structuredClone(cluster._driftAtlas.simulation),world=buildWorld(cluster);
 const batch=await advanceTurns(before,world,cluster._driftAtlas.systems,MAX_BATCH_TURNS,{yieldControl:async()=>{}});
 cluster._driftAtlas.simulation=batch.simulation;cluster._driftAtlas.systems=batch.ownership;syncCluster(cluster);
 cluster=composeCluster(JSON.parse(JSON.stringify(cluster._driftAtlasCluster)));const reloaded=cluster._driftAtlas.simulation;
 assert.equal(reloaded.turn,MAX_BATCH_TURNS);assert.equal(reloaded.history.length,MAX_BATCH_TURNS);assert.equal(reloaded.undo.simulation.turn,0);assert.equal(reloaded.undo.simulation.seed,before.seed);validateSimulationState(reloaded);
});
