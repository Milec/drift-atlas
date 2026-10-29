import {importGeneratorFactions,locationOwners} from './faction-import.js';
import {validateSimulationState} from './simulation.js';
import {mountSimulation} from './simulation-ui.js';
import {mountFactions,factionCatalog} from './factions.js';
import {DepthRenderer} from './depth-render.js';
import {clusterOf,createCluster,composeCluster,syncCluster,extractSector,sectorName,memberGrid,clusterBounds} from './clusters.js';
import {mountClusterManager} from './cluster-ui.js';
import {sectorStore,sectorId} from './sector-store.js';
import {buildLanes,findLanePath,buildSystemGates} from './navigation.js';
import {drawObjectModel,modelKind,modelInfo,modelExtent,surfaceTypes} from './models.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
let data,nodes=[],all=[],selected,routeOpen=false,search='',spread=1,showHidden=true,originKey='',saved={},storageOK=true;
let laneEdges=[],plottedCourse=null,mapBoundsCache=null;
let armedSystemId=null;
let systemMode=false,localBodies=[],bodySelected=null,sectorCamera=null,localExtent=10;
let yaw=-.26,pitch=.65,zoom=1,panX=0,panY=0,topView=false;
let cameraFocus=null,focusedSectorId=null,cameraMotion=null,entryState=null,sectorSurfaces=[];
const canvas=$('#space'),ctx=canvas.getContext('2d'),depthRenderer=new DepthRenderer();let w=0,h=0,dpr=1,projected=[],dirty=true;
const toast=m=>{$('#toast').textContent=m;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',3500)};
let saveQueue=Promise.resolve(),saveTimer,libraryBusy=true,saveErrorShown=false,editRevision=0;
function snapshot(){
 const out=structuredClone(data);
 out._driftAtlas={...out._driftAtlas,version:1,systems:structuredClone(saved),lanes:structuredClone(laneEdges),heightNote:'Z values are map units, not official Starfinder distances.'};
 for(const n of nodes){out[n.type][n.id].z=n.z;out._driftAtlas.systems[n.id]={...saved[n.id],z:n.z};}
 return syncCluster(out);
}
function mapName(d){return clusterOf(d)?.name||sectorName(d);}
function recordFor(out){const meta=clusterOf(out);return {id:sectorId(out),kind:meta?'cluster':'sector',name:mapName(out),updatedAt:Date.now(),systems:Object.keys(out.system).length,worlds:Object.keys(out.planet||{}).length,sectors:meta?.members.length||1,data:out};}
function queueSnapshot(out,activate=true,current=true){
 const editKey=originKey,editBackup=JSON.stringify(saved),revision=editRevision,record=recordFor(out),id=record.id;
 if(current)$('#data-state').textContent='SAVING…';
 saveQueue=saveQueue.then(async()=>{
  try{await sectorStore.save(record,activate);if(current){try{if(localStorage.getItem(editKey)===editBackup)localStorage.removeItem(editKey);}catch{}storageOK=true;saveErrorShown=false;if(data&&sectorId(data)===id&&editRevision===revision)$('#data-state').textContent='SAVED ON DEVICE';}return true;}
  catch{if(current){storageOK=false;$('#data-state').textContent='NOT SAVED';}$('#library-status').textContent='Could not save in this browser. Export JSON to keep your map and changes.';if(!saveErrorShown){toast('Map could not be saved in this browser. Export JSON to keep your changes.');saveErrorShown=true;}return false;}
 });return saveQueue;
}
function saveCurrent(){clearTimeout(saveTimer);return data?queueSnapshot(snapshot()):Promise.resolve(false);}
function persist(){
 editRevision++;try{localStorage.setItem(originKey,JSON.stringify(saved));}catch{try{localStorage.removeItem(originKey);}catch{}}
 $('#data-state').textContent='SAVING…';clearTimeout(saveTimer);saveTimer=setTimeout(saveCurrent,200);
}
function updateMapHeading(){
 const meta=clusterOf(data),name=mapName(data);$('nav button[data-tab="atlas"] span').textContent=meta?'Cluster map':'Sector map';$('#sector-name').textContent=name;document.title=`Drift Atlas · ${name}`;
 $('#map-scope').textContent=meta?'SECTOR CLUSTER':'LOCAL SECTOR';$('#view-kind').textContent=meta?'CLUSTER EXPLORER':'SECTOR EXPLORER';$('#sector-code').textContent=meta?`${meta.members.length} SECTOR${meta.members.length===1?'':'S'}`:'SWN–01';
 $('.sector-heading>p').textContent=meta?`${meta.members.length} sector grid${meta.members.length===1?'':'s'} · ${meta.bridges.length} cross-sector lane${meta.bridges.length===1?'':'s'}`:'A thousand stories. One uncharted frontier.';
 $('#export').textContent=meta?'↓ Export current cluster':'↓ Export current sector';$('#back-sector').textContent=meta?'← Cluster map':'← Sector map';
}
function memberName(n){const m=clusterOf(data)?.members.find(m=>m.id===n?._clusterMember);return m?sectorName(m.sector):'';}
function nodeLabel(n){const sector=memberName(n);return n.name+(sector?' · '+sector:'');}
async function renderSectorLibrary(){
 const meta=clusterOf(data);$('#sector-save-choice').hidden=!meta;
 if(meta){const prior=$('#save-member').value;$('#save-member').innerHTML=meta.members.map((m,i)=>`<option value="${esc(m.id)}">${i+1}. ${esc(sectorName(m.sector))}</option>`).join('');if(meta.members.some(m=>m.id===prior))$('#save-member').value=prior;}
 try{
  const rows=await sectorStore.list(),current=data?sectorId(data):null;
  const rowHTML=r=>`<article class="saved-sector" data-sector="${esc(r.id)}" data-kind="${r.kind||'sector'}"><div><span class="save-type">${r.kind==='cluster'?'CLUSTER':'SECTOR'}</span><h3>${esc(r.name)}</h3><p>${r.kind==='cluster'?r.sectors+' sector'+(r.sectors===1?'':'s')+' · ':''}${r.systems} systems · ${r.worlds} worlds</p><small>Saved ${esc(new Date(r.updatedAt).toLocaleString())}</small></div><div class="saved-sector-actions"><button class="button open-sector" ${r.id===current?'disabled':''}>${r.id===current?'Current':'Open'}</button><button class="remove-sector" aria-label="Remove ${esc(r.name)}" ${r.id===current?'disabled title="Open a different map before removing this one."':''}>Remove</button></div></article>`;
  $('#sector-library').innerHTML=rows.length?['cluster','sector'].map(kind=>{const group=rows.filter(r=>(r.kind||'sector')===kind);return group.length?`<section class="library-group"><h3>${kind==='cluster'?'Clusters':'Sectors'} <span>${group.length}</span></h3>${group.map(rowHTML).join('')}</section>`:'';}).join(''):'<p class="help">No saved maps yet. Save this map or import a generator JSON.</p>';
 }catch{$('#sector-library').textContent='Saved maps are unavailable in this browser. JSON import and export are still available.';}
}
async function switchSector(getData){
 if(libraryBusy)return;libraryBusy=true;$('#library-status').textContent='Opening map…';
 try{await saveCurrent();const next=await getData();if(!next)throw Error('This saved map is no longer available.');load(next,true);await saveCurrent();$('#sectors-dialog').close();}
 catch(e){$('#library-status').textContent='Could not open map: '+e.message;}
 finally{libraryBusy=false;}
}
$('#menu-saves').onclick=async()=>{$('#main-menu').close();cancelCamera(true);$('#cluster-name').value=clusterOf(data)?.name||(data?sectorName(data)+' Cluster':'New Cluster');$('#sectors-dialog').showModal();$('#library-status').textContent='Sectors, clusters, and campaign edits save automatically on this device.';await saveQueue;await renderSectorLibrary();};
$('#close-sectors').onclick=()=>{$('#sectors-dialog').close();$('#main-menu').showModal();};
$('#sectors').onclick=()=>{cancelCamera(true);$('#main-menu').showModal();};
$('#close-menu').onclick=()=>$('#main-menu').close();
const factions=mountFactions({getData:()=>data,getAll:()=>all,getNodes:()=>nodes,getSaved:()=>saved,getLanes:()=>laneEdges,commit:saveCurrent,invalidate:()=>{dirty=true;}});
$('#dossier').addEventListener('change',factions.handleDetails);
$('#menu-factions').onclick=()=>{$('#main-menu').close();factions.open();};
const simulation=mountSimulation({getData:()=>data,getSaved:()=>saved,replaceSaved:edits=>{saved=edits;editRevision++;},commit:saveCurrent,invalidate:()=>{factions.refresh();renderDossier();renderList();dirty=true;},focusLocation:id=>{const entity=all.find(n=>n.id===id);let n=entity,seen=new Set();while(n&&!nodes.some(s=>s.id===n.id)&&!seen.has(n.id)){seen.add(n.id);n=all.find(a=>a.id===n.parent);}if(n){if(systemMode)leaveSystem();clearLocationSelection();choose(n.id);focusNode(n);}}});
$('#menu-simulation').onclick=()=>{$('#main-menu').close();simulation.open();};$('#simulation-clock').onclick=()=>simulation.open();

$('#save-sector').onclick=async()=>{if(libraryBusy)return;libraryBusy=true;$('#save-sector').disabled=true;try{let ok;if(clusterOf(data)){await saveCurrent();ok=await queueSnapshot(extractSector(snapshot(),$('#save-member').value),false,false);}else ok=await saveCurrent();$('#library-status').textContent=ok?'Sector saved on this device.':'Could not save. Export JSON to keep your map.';await renderSectorLibrary();}finally{libraryBusy=false;$('#save-sector').disabled=false;}};
$('#save-cluster').onclick=async()=>{
 if(libraryBusy||!data)return;const name=$('#cluster-name').value.trim();if(!name){$('#library-status').textContent='Enter a name for the cluster.';$('#cluster-name').focus();return;}
 libraryBusy=true;$('#save-cluster').disabled=true;
 try{await saveCurrent();if(!clusterOf(data))load(createCluster(snapshot(),name),true);else{data._driftAtlasCluster.name=name;updateMapHeading();}const ok=await saveCurrent();$('#library-status').textContent=ok?'Cluster saved with its sectors, placement, and connections.':'Could not save. Export JSON to keep your cluster.';await renderSectorLibrary();}catch(e){$('#library-status').textContent=e.message;}finally{libraryBusy=false;$('#save-cluster').disabled=false;}
};
const clusterManager=mountClusterManager({store:sectorStore,getSnapshot:snapshot,save:saveCurrent,activate:async combined=>{load(combined,true);clearLocationSelection();return saveCurrent();},toast});
$('#add-sector').onclick=async()=>{if(libraryBusy||!data)return;$('#main-menu').close();libraryBusy=true;try{await saveCurrent();await clusterManager.open();}catch(e){toast(e.message);}finally{libraryBusy=false;}};
$('#default-sector').onclick=()=>switchSector(async()=>{const r=await fetch('./sector.json');if(!r.ok)throw Error('The default sector could not be loaded.');const bundled=await r.json();try{return (await sectorStore.get(sectorId(bundled)))?.data||bundled;}catch{return bundled;}});
$$('#library-import,#library-import-cluster').forEach(button=>button.onclick=()=>{if(libraryBusy)return;$('#sectors-dialog').close();$('#upload').click();});
$('#sector-library').onclick=async e=>{
 if(libraryBusy)return;const row=e.target.closest('[data-sector]');if(!row)return;
 const id=row.dataset.sector;
 if(e.target.closest('.open-sector')){await switchSector(async()=>{const r=await sectorStore.get(id);return r?.data;});}
 else if(e.target.closest('.remove-sector')&&id!==sectorId(data)){
  const name=row.querySelector('h3').textContent;if(!confirm(`Remove “${name}” from this device? Export a backup first if you need to keep it.`))return;
  libraryBusy=true;try{await saveQueue;await sectorStore.remove(id);try{localStorage.removeItem('drift-atlas:edits:'+id);}catch{}await renderSectorLibrary();$('#library-status').textContent='Map removed from this device.';}catch{$('#library-status').textContent='Could not remove the saved map.';}finally{libraryBusy=false;}
 }
};
$('#sectors-dialog').onclick=e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();};
function load(d,restored=false){
 cancelCamera(true);
 if(clusterOf(d))d=composeCluster(clusterOf(d));
 validateSimulationState(d?._driftAtlas?.simulation);
 if(!d||typeof d!=='object'||Array.isArray(d)||!d.system||typeof d.system!=='object'||Array.isArray(d.system)||!Object.keys(d.system).length)throw Error('Choose a SWN JSON export with a non-empty system collection.');
 const temp=[];for(const type of ['system','blackHole'])for(const [id,n] of Object.entries(d[type]||{})){if(!n||!Number.isFinite(Number(n.x))||!Number.isFinite(Number(n.y)))throw Error('Each map entity must contain numeric X and Y coordinates.');temp.push({id,...n,type});}
 if(temp.length>3000)throw Error('This atlas supports up to 3,000 map entities.');
 importGeneratorFactions(d);
 if(routeOpen)closeRoute();if(systemMode)leaveSystem();localRoute=false;routeMemory.clear();
 data=d;originKey='drift-atlas:edits:'+sectorId(d);try{const prior=localStorage.getItem(originKey),legacy=!restored&&prior===null?localStorage.getItem('drift-atlas:'+hash(Object.keys(d.system).sort().join('|'))):null;saved=JSON.parse(prior||legacy||'{}')||{};if(legacy)localStorage.setItem(originKey,legacy);}catch{saved={};}
 saved={...(d._driftAtlas?.systems||{}),...saved};
 if(clusterOf(d)){const present=new Set(Object.entries(d).filter(([type,group])=>!type.startsWith('_')&&group&&typeof group==='object'&&!Array.isArray(group)).flatMap(([,group])=>Object.keys(group)));saved=Object.fromEntries(Object.entries(saved).filter(([id])=>present.has(id)));}
 nodes=temp.map(n=>{const a=saved[n.id]||{};return {...n,z:Number.isFinite(a.z)?a.z:Number.isFinite(n.z)?n.z:Math.round(((hash(n.id)%1000)/999*2-1)*2.4*100)/100}});
 laneEdges=buildLanes(nodes,d._driftAtlas?.lanes);mapBoundsCache=clusterOf(d)?clusterBounds(clusterOf(d)):nodeBounds(nodes);plottedCourse=null;updateCourseSummary();
 all=[];for(const [type,group]of Object.entries(data)){if(type.startsWith('_')||!group||typeof group!=='object'||Array.isArray(group))continue;for(const [id,n]of Object.entries(group))if(n&&typeof n==='object'&&n.name)all.push({id,...n,type});}
 updateMapHeading();factions.refresh();simulation.refresh();
 armedSystemId=null;document.body.classList.remove('has-selection');selected=nodes.find(n=>n.type==='system');$('#search').value='';search='';$('#systems-count').textContent=nodes.filter(n=>n.type==='system').length;$('#worlds-count').textContent=Object.keys(d.planet||{}).length;$('#holes-count').textContent=String(Object.keys(d.blackHole||{}).length).padStart(2,'0');
 for(const id of ['from','to'])$('#'+id).innerHTML=nodes.map(n=>`<option value="${esc(n.id)}">${esc(nodeLabel(n))}${n.type==='blackHole'?' · black hole':''}</option>`).join('');
 $('#to').selectedIndex=Math.min(1,nodes.length-1);reset();setExplorerOpen(innerWidth>800);renderList();renderDossier();renderRoute();$('#data-state').textContent=restored?'IMPORTED SECTOR':'DEFAULT SECTOR';
}
const children=n=>all.filter(a=>a.parent===n.id&&a.parentEntity===n.type&&(showHidden||!a.isHidden));
function descendants(n,seen=new Set()){if(seen.has(n.id))return [];seen.add(n.id);return children(n).flatMap(c=>[c,...descendants(c,seen)]);}
function visible(n){return !!n&&(showHidden||!n.isHidden)}
function matches(n){return !search||memberName(n).toLowerCase().includes(search)||[n,...descendants(n)].some(a=>a.name.toLowerCase().includes(search));}
function renderList(){if(systemMode){renderLocalList();return;}const list=nodes.filter(n=>visible(n)&&matches(n));$('#system-list').innerHTML=list.length?list.map(n=>`<button class="system-row ${selected?.id===n.id?'selected':''}" data-id="${esc(n.id)}"><i style="background:${stellar(n).color};box-shadow:0 0 9px ${stellar(n).color}66" class="dot ${n.type==='blackHole'?'purple':''}"></i><span>${esc(n.name)}<small>${String(n.x).padStart(2,'0')} : ${String(n.y).padStart(2,'0')} ${n.isHidden?'· HIDDEN':''}${memberName(n)?' · '+esc(memberName(n)):''}</small></span><span class="count">${children(n).filter(a=>a.type==='planet').length.toString().padStart(2,'0')}</span></button>`).join(''):'<p class="empty">No matching systems or worlds.</p>';$$('.system-row').forEach(el=>el.onclick=()=>choose(el.dataset.id));dirty=true;}
const typeName=s=>s.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
function entityHTML(n,level=0,seen=new Set()){
 if(level>7||seen.has(n.id))return '';seen=new Set(seen).add(n.id);
 const attrs=Object.entries(n.attributes||{});return `<details class="world"><summary><span>${esc(n.name)} <small style="color:#6e8995;font-size:8px">${esc(n.type==='driftGate'?'ENTRANCE / EXIT':typeName(n.type))}</small></span></summary><div class="world-content">${(!systemMode||bodySelected?.id!==n.id)?factions.details(n)+simulation.details(n.id):''}${attrs.length?'<dl>'+attrs.map(([k,v])=>`<dt>${esc(typeName(k))}</dt><dd>${Array.isArray(v)?v.map(t=>typeof t==='object'?`<details class="tag"><summary>${esc(t.name||'Details')}</summary>${Object.entries(t).filter(([key])=>key!=='name').map(([key,value])=>`<p><b>${esc(typeName(key))}:</b> ${esc(Array.isArray(value)?value.join('; '):value)}</p>`).join('')}</details>`:esc(t)).join(', '):esc(typeof v==='object'?JSON.stringify(v):v)}</dd>`).join('')+'</dl>':'<span>No additional attributes recorded.</span>'}${children(n).map(c=>entityHTML(c,level+1,seen)).join('')}</div></details>`;
}
function renderDossier(){if(!selected||(systemMode&&!bodySelected)){$('#dossier').hidden=true;return;}$('#dossier').hidden=routeOpen;if(systemMode&&bodySelected&&bodySelected.id!==selected.id){renderBodyDossier();return;}const n=selected,cs=children(n),desc=descendants(n),worlds=cs.filter(c=>c.type==='planet'),facilities=desc.filter(c=>!['planet','moon','asteroidBelt'].includes(c.type));
 $('#dossier').innerHTML=`<div class="panel-title">SYSTEM DOSSIER <span class="tiny">${n.type==='blackHole'?'ANOMALY':'SURVEYED'} <i></i></span></div><div class="dossier-hero"><div class="orbit"></div><div class="orbit two"></div><div style="--star-color:${stellar(n).color}" class="orb ${n.type==='blackHole'?'black-hole':''}"></div><span class="hero-label">${esc(n.type==='blackHole'?'GRAVITATIONAL SINGULARITY':stellar(n).label+' · CLASS '+stellar(n).key)}</span></div><div class="dossier-body"><span class="badge">${esc(typeName(n.type))} / ${n.isHidden?'HIDDEN':'CATALOGUED'}${memberName(n)?' / '+esc(memberName(n)):''}</span><h2>${esc(n.name)}</h2>${factions.details(n)}${simulation.details(n.id)}<div class="coords">X ${esc(n.x)} &nbsp; Y ${esc(n.y)} &nbsp; Z ${n.z.toFixed(2)}</div><div class="mini-stats"><div><b>${worlds.length.toString().padStart(2,'0')}</b>WORLDS</div><div><b>${facilities.length.toString().padStart(2,'0')}</b>FACILITIES</div><div><b>${cs.filter(c=>c.type==='asteroidBelt').length.toString().padStart(2,'0')}</b>BELTS</div></div><button id="navigate" class="primary">⌁ &nbsp; Set as destination</button><button id="focus" class="secondary">${systemMode?"⊙ &nbsp; Center on star":"↳ &nbsp; Enter system"}</button>${n.type==='system'?`<label class="field">STELLAR CLASS<select id="stellar-class">${Object.entries(stellarClasses).map(([key,st])=>`<option value="${key}" ${stellar(n).key===key?"selected":""}>${key} · ${st.label}</option>`).join("")}</select></label><p class="help">Assigned appearance · editable; source has no stellar classification.</p>`:""}<div class="subheading">SYSTEM CONTENTS <span style="float:right">${cs.length}</span></div>${cs.length?cs.map(c=>entityHTML(c)).join(''):'<p class="help">No worlds or stations recorded.</p>'}<label class="field">HEIGHT · Z COORDINATE<input id="height" type="number" step="0.1" min="-1000" max="1000" value="${n.z}"></label><p class="help" style="margin-top:-7px">${Number.isFinite(n.z)&&!Number.isFinite(data[n.type]?.[n.id]?.z)?'Seeded height · editable map units':'Source height · editable map units'}</p><div class="subheading">CAPTAIN’S NOTES <span class="saved">${storageOK?'SAVED LOCALLY':'EXPORT TO SAVE'}</span></div><textarea id="notes" class="notes" placeholder="Rumors, discoveries, unfinished business…">${esc(saved[n.id]?.notes||'')}</textarea></div>`;
 $('#dossier .panel-title').insertAdjacentHTML('beforeend','<button class="iconbtn" id="close-system-details" aria-label="Close system details">×</button>');$('#close-system-details').onclick=clearLocationSelection;$('#navigate').onclick=()=>{if(systemMode){setLocalEndpoint(n.id,'to');return;}openRoute();$('#to').value=n.id;renderRoute();rememberRoute()};$('#focus').onclick=()=>systemMode?focusNode(localBodies[0]):enterSystem(n.id);if($('#stellar-class'))$('#stellar-class').onchange=e=>{saved[n.id]={...saved[n.id],stellarClass:e.target.value};persist();renderList();renderDossier();if(systemMode)$('#system-subtitle').textContent=`${stellar(n).label} · Class ${stellar(n).key} · ${localBodies.filter(n=>!n.localStar&&!n.generated).length} objects · ${localBodies.filter(n=>n.type==='driftGate').length} gates`;dirty=true};
 $('#height').onchange=e=>{const z=Number(e.target.value);if(!Number.isFinite(z)||Math.abs(z)>1000){e.target.value=n.z;toast('Use a height between −1000 and 1000.');return}n.z=z;saved[n.id]={...saved[n.id],z};persist();if(systemMode)makeLocalLayout();dirty=true;renderDossier();renderRoute()};
 $('#notes').oninput=e=>{saved[n.id]={...saved[n.id],notes:e.target.value};persist()};dirty=true;
}
function choose(id){const n=nodes.find(a=>a.id===id);if(!n)return;if(armedSystemId===id&&selected?.id===id){enterSystem(id);return;}armedSystemId=id;selected=n;if(routeOpen)closeRoute();renderList();renderDossier();$('#selection-name').textContent=n.name;$('#selection-info').textContent=`${children(n).filter(c=>c.type==='planet').length} worlds · Tap again to enter`;document.body.classList.add('has-selection');if(innerWidth<=800)setExplorerOpen(false);$('#dossier').classList.remove('mobile-open');dirty=true;}
$('#selection-enter').onclick=()=>{if(selected)enterSystem(selected.id)};$('#selection-details').onclick=()=>$('#dossier').classList.toggle('mobile-open');
let localRoute=false;
const routeMemory=new Map();
const profiles={vast:{n:0,sides:6,plus:0,unit:'days'},lane:{n:0,sides:6,plus:7,unit:'days'},'system-standard':{n:1,sides:6,plus:2,unit:'days'},'system-drift':{n:1,sides:6,plus:0,unit:'days'},satellite:{n:0,sides:6,plus:1,unit:'hours'},landing:{n:0,sides:6,plus:1,unit:'hours'},surface:{n:1,sides:4,plus:0,unit:'hours'}};
const localProfiles=['system-standard','system-drift','satellite','landing','surface'];
const routeKey=()=>localRoute?'local:'+selected?.id:'sector';
const routeObjects=()=>localRoute?localBodies.filter(visible):nodes.filter(visible);
function rememberRoute(){routeMemory.set(routeKey(),{from:$('#from').value,to:$('#to').value,profile:$('#profile').value,outcome:$('#outcome').value});}
function configureRoute(){const objects=routeObjects(),prior=routeMemory.get(routeKey())||{};
 for(const id of ['from','to']){const el=$('#'+id);el.innerHTML=objects.map(n=>`<option value="${esc(n.id)}">${esc(n.localStar?n.name+' · system arrival point':localRoute?n.name+' · '+typeName(n.type):nodeLabel(n))}</option>`).join('');if(objects.some(n=>n.id===prior[id]))el.value=prior[id];else if(id==='to')el.selectedIndex=Math.min(1,objects.length-1);}
 for(const opt of $('#profile').options){const allowed=localProfiles.includes(opt.value)===localRoute;opt.disabled=!allowed;opt.hidden=!allowed;}
 $('#profile').value=prior.profile&&localProfiles.includes(prior.profile)===localRoute?prior.profile:localRoute?'system-standard':'vast';$('#outcome').value=prior.outcome||'success';$('#route-scope').value=localRoute?'local':'sector';$('#route-context').textContent=localRoute?selected.name+' · local navigation':'Interstellar navigation';renderRoute();
}
function explorerIsOpen(){return !$('#explorer').hidden&&(innerWidth>800||$('#explorer').classList.contains('mobile-open'));}
function setExplorerOpen(open){$('#explorer').hidden=!open;$('#explorer').classList.toggle('mobile-open',open);if(!open&&$('nav button[data-tab="catalog"]').classList.contains('active')){$('nav button[data-tab="catalog"]').classList.remove('active');if(!routeOpen)$('nav button[data-tab="atlas"]').classList.add('active');}dirty=true;}
function showSystems(){ $('#layers-panel').hidden=true;$('#system-browser').hidden=false;$('#show-layers').classList.remove('active');$('#show-systems').classList.add('active'); }
function dismissMapPanels(){setExplorerOpen(false);if(routeOpen)closeRoute();}
function openRoute(){cancelCamera(true);setExplorerOpen(false);localRoute=systemMode;configureRoute();routeOpen=true;$('#route-panel').hidden=false;$('#dossier').hidden=true;document.body.classList.remove('has-selection');$$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='route'));dirty=true;}
function closeRoute(){if(routeOpen)rememberRoute();routeOpen=false;updateCourseSummary();$('#route-panel').hidden=true;$('#dossier').hidden=!selected||(systemMode&&!bodySelected);$$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='atlas'));dirty=true;}
function setLocalEndpoint(id,role){if(!systemMode)return;const prior=routeMemory.get('local:'+selected.id)||{},wasSet=!!prior[role==='from'?'to':'from'];openRoute();$('#'+role).value=id;const other=role==='from'?'to':'from';if(!wasSet&&$('#'+other).value===id){const alt=routeObjects().find(n=>n.id!==id);if(alt)$('#'+other).value=alt.id;}rememberRoute();renderRoute();}
$('#route-scope').onchange=e=>{const next=e.target.value;if(routeOpen)rememberRoute();closeRoute();if(next==='local'){if(!systemMode)enterSystem((selected||nodes.find(visible)).id,false);}else if(systemMode)leaveSystem();openRoute();};
function normalizeTravelMode(){if(localRoute)return;for(const key of ['lane','vast']){const o=$(`#profile option[value="${key}"]`);o.disabled=false;o.hidden=false;}if(!['lane','vast'].includes($('#profile').value))$('#profile').value='vast';const path=findLanePath(nodes.filter(visible),laneEdges,$('#from').value,$('#to').value),jumps=path?path.length-1:0;$('#profile option[value="vast"]').textContent=jumps>0?`The Vast · ${jumps*4}d6 days`:'The Vast · (jumps × 4)d6 days';}
function courseFromInfo(info){if(!info.valid)return null;return {local:localRoute,systemId:localRoute?selected.id:null,from:info.a.id,to:info.b.id,key:info.key,path:info.key==='lane'?info.path:[info.a.id,info.b.id],jumps:info.path?info.path.length-1:null};}
function courseMatchesView(c){return !!c&&c.local===systemMode&&(!c.local||c.systemId===selected?.id);}
function updateCourseSummary(){const c=plottedCourse,show=courseMatchesView(c)&&!routeOpen;$('#course-summary').hidden=!show;document.body.classList.toggle('course-visible',show);if(!show)return;const objects=c.local?localBodies:nodes,a=objects.find(n=>n.id===c.from),b=objects.find(n=>n.id===c.to);$('#course-name').textContent=`${a?.name||'Unknown'} → ${b?.name||'Unknown'}`;$('#course-mode').textContent=c.local?'Local course · direct route':c.key==='lane'?`Drift lanes · ${c.jumps} jump${c.jumps===1?'':'s'} · ${c.jumps*7} days base`:`The Vast · ${c.jumps*4}d6 days · direct route`;}
function plotCourse(){const info=routeInfo();if(!info.valid)return;plottedCourse=courseFromInfo(info);$('#plot-status').textContent='Course plotted. Close the flight computer to view the highlighted route.';rememberRoute();updateCourseSummary();dirty=true;}
$('#plot-course').onclick=plotCourse;
$('#clear-course').onclick=()=>{plottedCourse=null;$('#plot-status').textContent='Course cleared.';updateCourseSummary();dirty=true};
function drawCourse(){let course=plottedCourse;if(routeOpen){const info=routeInfo();course=info.valid?courseFromInfo(info):null;}if(!courseMatchesView(course))return;const objects=systemMode?localBodies:nodes,path=course.path.map(id=>objects.find(n=>n.id===id));if(path.some(n=>!visible(n)))return;const color=course.key==='lane'?'#f3c477':'#85e7da';ctx.save();ctx.lineCap='round';for(let i=1;i<path.length;i++){const a=project(path[i-1].x,path[i-1].y,path[i-1].z),b=project(path[i].x,path[i].y,path[i].z);if(course.key==='lane'){line(a,b,'#f3c47730',8);line(a,b,color,2.6)}else line(a,b,color,2,[8,5]);const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len>35){const x=a.x+dx*.58,y=a.y+dy*.58,angle=Math.atan2(dy,dx);ctx.beginPath();ctx.moveTo(x+Math.cos(angle)*5,y+Math.sin(angle)*5);ctx.lineTo(x+Math.cos(angle+2.5)*5,y+Math.sin(angle+2.5)*5);ctx.lineTo(x+Math.cos(angle-2.5)*5,y+Math.sin(angle-2.5)*5);ctx.closePath();ctx.fillStyle=color;ctx.fill();}}
 for(const n of path){if(projected.find(p=>p.n.id===n.id)?.hidden)continue;const p=project(n.x,n.y,n.z);ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.stroke()}ctx.restore();}

function anchor(n){const seen=new Set();while(n&&!seen.has(n.id)){if(['planet','moon'].includes(n.type))return n.id;seen.add(n.id);n=all.find(a=>a.id===n.parent&&a.type===n.parentEntity);}return null;}
function satellitePair(a,b){if(!a||!b)return false;const isPair=(parent,child)=>['planet','moon'].includes(parent.type)&&child.parent===parent.id&&child.parentEntity===parent.type&&['moon','spaceStation','deepSpaceStation','refuelingStation','orbitalRuin'].includes(child.type);return isPair(a,b)||isPair(b,a);}
function routeInfo(){const objects=routeObjects(),a=objects.find(n=>n.id===$('#from').value),b=objects.find(n=>n.id===$('#to').value),path=localRoute?null:findLanePath(nodes.filter(visible),laneEdges,a?.id,b?.id),jumps=path?path.length-1:0,requested=$('#profile').value,key=localRoute?requested:requested==='lane'?'lane':'vast',p=key==='lane'?{...profiles.lane,plus:7*jumps}:key==='vast'?{...profiles.vast,n:jumps*4}:profiles[key];let reason='';
 if(!a||!b)reason='Choose a departure and destination.';else if(!localRoute&&!path)reason='No lane path joins these systems, so the jump count needed to calculate travel time is unavailable.';else if(localProfiles.includes(key)!==localRoute)reason='Choose a travel profile for this route.';else if(key==='satellite'&&!satellitePair(a,b))reason='Choose a planet or moon and one of its moons or orbiting stations.';else if(['landing','surface'].includes(key)&&(!anchor(a)||anchor(a)!==anchor(b)))reason='Choose locations associated with the same planet or moon.';else if(key==='landing'&&![a,b].some(n=>['planet','moon'].includes(n.type)))reason='Choose a planet or moon as one endpoint for a launch or landing.';else if(key==='surface'&&[a,b].some(n=>['spaceStation','deepSpaceStation','refuelingStation','orbitalRuin'].includes(n.type)))reason='Surface travel requires two surface locations, not an orbital station.';else if(!['landing','surface'].includes(key)&&a.id===b.id)reason='Choose two different locations.';
 return {a,b,key,p,path,jumps,critical:p.unit==='days'&&$('#outcome').value==='critical',valid:!reason,reason};
}
function renderRoute(){if(!nodes.length)return;normalizeTravelMode();const {a,b,p,critical,valid,key,reason,path,jumps}=routeInfo(),hourly=p.unit==='hours',outcome=hourly?'success':$('#outcome').value;$('#outcome-field').hidden=hourly;$('#roll-result').textContent='';$('#plot-course').disabled=!valid;$('#plot-course').style.opacity=valid?1:.4;$('#plot-status').textContent='Preview · Plot course to keep the route on the map.';$('#roll').disabled=!valid;$('#roll').style.opacity=valid?1:.4;
 $('#route-help').textContent=localRoute?(key==='satellite'?'The planet or moon endpoint represents its orbit. Reaching its satellite takes 1 hour; a surface launch or landing is a separate leg.':key==='landing'?'One launch or landing leg takes 1 hour. Select the same world for both endpoints, or a world and its associated location.':key==='surface'?'Use this for surface-to-surface locations on one world. The same world may be selected twice to represent two sites.':'Choose any two locations in this system. Standard engines use 1d6+2 days; Drift engines use 1d6 days. The schematic map does not determine travel time.'):`Campaign travel rule: one map connection is one jump. ${key==='lane'?'Each highlighted lane segment takes 7 days. Three jumps take 21 days before Plot Course adjustments.':!path?'The Vast needs an equivalent connected lane path to determine the jump count and dice pool. No travel time can be calculated for these endpoints.':`The Vast uses (jumps × 4)d6 days. ${jumps} × 4 = ${jumps*4}: roll ${p.n}d6 days. The route line goes directly to the destination; dice count comes from the equivalent shortest lane path.`}`;
 const lo=p.n+p.plus,hi=p.n*p.sides+p.plus,adj=n=>critical?Math.max(1,n/2):n,unit=n=>n===1?(hourly?'hour':'day'):p.unit,range=adj(lo)===adj(hi)?`${adj(lo)} ${unit(adj(lo))}`:`${adj(lo)}–${adj(hi)} ${p.unit}`,formula=key==='lane'?`${Math.max(0,(path?.length||1)-1)} jump${path?.length===2?'':'s'} × 7 days = ${p.plus} days`:key==='vast'?`${jumps} × 4 = ${p.n}d6 days`:p.n?`${p.n}d${p.sides}${p.plus?'+'+p.plus:''} ${p.unit}`:`${p.plus} ${unit(p.plus)}`;
 $('#route-region').hidden=localRoute||!a||!b||a.id===b.id;$('#route-region').textContent=localRoute?'':`${path?jumps+' JUMP'+(jumps===1?'':'S')+' · '+(key==='lane'?p.plus+' DAYS BASE':p.n+'D6 DAYS')+' · AUTOMATIC':'JUMP COUNT UNAVAILABLE'}`;$('#route-itinerary').textContent=!localRoute&&key==='lane'&&path?path.map(id=>nodes.find(n=>n.id===id).name).join(' → '):'';
 const sub=localRoute?`${esc(a?.name||'')} → ${esc(b?.name||'')}`:a&&b?`${Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z).toFixed(2)} MAP UNITS · GEOMETRIC DISTANCE`:'';
 $('#route-result').innerHTML=!valid?`<span>${esc(reason)}</span>`:`<small>${sub}</small><b>${outcome==='lost'?'Course lost':outcome==='failure'?'GM delay required':range}</b><small>${outcome==='lost'?'Arrive in an unfamiliar system; plot a new course.':outcome==='failure'?`BASE ${lo}–${hi} ${p.unit.toUpperCase()} · ADD A GM-DETERMINED DELAY`:`${formula.toUpperCase()} · EXPECTED ${adj(p.n*(p.sides+1)/2+p.plus)} ${unit(adj(p.n*(p.sides+1)/2+p.plus)).toUpperCase()}${critical?' · CRITICAL SUCCESS':''}`}</small>`;dirty=true;
}
$('#roll').onclick=()=>{const {p,critical,valid}=routeInfo();if(!valid)return;plotCourse();const dice=Array.from({length:p.n},()=>Math.floor(Math.random()*p.sides)+1),base=dice.reduce((a,b)=>a+b,0)+p.plus,outcome=p.unit==='hours'?'success':$('#outcome').value,total=critical?Math.max(1,base/2):base,unit=total===1?(p.unit==='hours'?'hour':'day'):p.unit;$('#roll-result').textContent=outcome==='lost'?'Unfamiliar system. The GM determines where you emerge; plot a new course.':`${dice.length?'Rolled '+dice.join(' + ')+(p.plus?' + '+p.plus:''):'Fixed travel time'} → ${total} ${unit}${outcome==='failure'?' + GM-determined delay.':'.'}`;};
for(const id of ['from','to','profile','outcome'])$('#'+id).onchange=()=>{renderRoute();rememberRoute()};
$('#close-route').onclick=closeRoute;

$$('nav button').forEach(b=>b.onclick=()=>{cancelCamera(true);if(b.dataset.tab==='route')openRoute();else{if(systemMode)leaveSystem();closeRoute();$$('nav button').forEach(n=>n.classList.toggle('active',n===b));if(b.dataset.tab==='catalog'){setExplorerOpen(true);$('#dossier').classList.remove('mobile-open');$('#search').focus()}else{setExplorerOpen(false);$('#dossier').classList.remove('mobile-open')}}});
$('#search').oninput=e=>{search=e.target.value.toLowerCase().trim();renderList()};
$('#show-layers').onclick=()=>{$('#layers-panel').hidden=false;$('#system-browser').hidden=true;$('#show-layers').classList.add('active');$('#show-systems').classList.remove('active')};$('#show-systems').onclick=showSystems;
for(const id of ['labels','grid','stems','links'])$('#'+id).onchange=()=>dirty=true;
$('#hidden').onchange=e=>{showHidden=e.target.checked;if(!visible(selected)){if(systemMode)leaveSystem();selected=nodes.find(visible);}if(systemMode){makeLocalLayout();if(!localBodies.some(n=>n.id===bodySelected?.id))bodySelected=selected;}renderList();renderDossier();if(routeOpen)configureRoute();dirty=true};
$('#spread').oninput=e=>{spread=e.target.value/100;$('#spread-val').textContent=e.target.value+'%';dirty=true};
function reset(keepTransition=false){if(keepTransition!==true)cancelCamera(true);cameraFocus=null;focusedSectorId=null;yaw=-.26;pitch=.65;zoom=1;panX=0;panY=0;topView=false;$('#view3d').classList.add('active');$('#view2d').classList.remove('active');$('#map-mode').textContent='PERSPECTIVE VIEW';dirty=true}
$('#reset').onclick=reset;$('#view3d').onclick=reset;$('#view2d').onclick=()=>{cancelCamera(true);pitch=Math.PI/2;yaw=0;topView=true;$('#view3d').classList.remove('active');$('#view2d').classList.add('active');$('#map-mode').textContent='TOP-DOWN VIEW';dirty=true};
$('#zoom-in').onclick=()=>{cancelCamera(true);zoom=Math.min(5,zoom*1.2);dirty=true};$('#zoom-out').onclick=()=>{cancelCamera(true);zoom=Math.max(.25,zoom/1.2);dirty=true};$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{toast('Fullscreen is unavailable in this browser.')}};
$('#help').onclick=()=>{cancelCamera(true);$('#help-dialog').showModal();};$('#help-close').onclick=()=>$('#help-dialog').close();
$('#upload').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;if(libraryBusy){e.target.value='';return;}libraryBusy=true;
 try{if(file.size>100e6)throw Error('Choose a JSON file smaller than 100 MB.');const next=JSON.parse(await file.text());if(!clusterOf(next)&&file.size>15e6)throw Error('Choose a sector JSON smaller than 15 MB.');await saveCurrent();load(next,true);const ok=await saveCurrent();if(ok)toast((clusterOf(data)?'Cluster':'Sector')+' imported and saved on this device.');}
 catch(err){toast('Import failed: '+err.message);}finally{libraryBusy=false;e.target.value='';}
};
$('#export').onclick=()=>{if(!data)return;const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=($('#sector-name').textContent.replace(/[^a-z0-9]+/gi,'-')||'sector')+(clusterOf(data)?'-cluster.json':'-3d.json');a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Sector exported with heights and campaign notes.')};
document.addEventListener('keydown',e=>{if($('dialog[open]'))return;if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='/'){e.preventDefault();setExplorerOpen(true);$('#search').focus()}if(e.key==='Escape'){if(entryState){leaveSystem();return;}if(routeOpen){closeRoute();return;}if(systemMode){leaveSystem();return;}setExplorerOpen(false);$('#dossier').classList.remove('mobile-open');closeRoute()}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){cancelCamera(true);e.preventDefault();}if(e.key==='ArrowLeft')yaw-=.1;if(e.key==='ArrowRight')yaw+=.1;if(e.key==='ArrowUp')pitch+=.1;if(e.key==='ArrowDown')pitch-=.1;if(e.key==='+')zoom=Math.min(5,zoom*1.1);if(e.key==='-')zoom=Math.max(.25,zoom/1.1);dirty=true});
// Perspective projection in a fully rotatable 3D coordinate space. Z is elevation.
function reducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
function cameraState(){const b=bounds();return {yaw,pitch,zoom,panX,panY,topView,focus:cameraFocus?{...cameraFocus}:{x:b.cx,y:b.cy,z:0},focusedSectorId};}
function restoreCamera(c){({yaw,pitch,zoom,panX,panY,topView}=c);cameraFocus=c.focus?{...c.focus}:null;focusedSectorId=c.focusedSectorId||null;dirty=true;}
function finishEntry(){entryState=null;document.body.classList.remove('entering-system');canvas.removeAttribute('data-transition');canvas.setAttribute('aria-busy','false');$('#entry-caption').hidden=true;dirty=true;}
function cancelCamera(restoreEntry=false){
 cameraMotion=null;
 if(entryState){if(restoreEntry&&entryState.phase==='approach'&&sectorCamera)restoreCamera(sectorCamera);else if(restoreEntry&&entryState.phase==='arrival'){zoom=1;panX=0;panY=0;cameraFocus=null;}finishEntry();}
 dirty=true;
}
function animateCamera(target,duration=440,done){
 const start=cameraState(),end={...start,...target,focus:target.focus?{...target.focus}:start.focus};
 cameraMotion={start,end,at:performance.now(),duration:reducedMotion()?0:duration,done};dirty=true;
}
function advanceCamera(now){
 const m=cameraMotion;if(!m)return;const t=m.duration?Math.max(0,Math.min(1,(now-m.at)/m.duration)):1,e=t*t*(3-2*t),lerp=(a,b)=>a+(b-a)*e;
 zoom=lerp(m.start.zoom,m.end.zoom);panX=lerp(m.start.panX,m.end.panX);panY=lerp(m.start.panY,m.end.panY);cameraFocus={x:lerp(m.start.focus.x,m.end.focus.x),y:lerp(m.start.focus.y,m.end.focus.y),z:lerp(m.start.focus.z||0,m.end.focus.z||0)};
 if(entryState)entryState.progress=t;dirty=true;if(t===1){cameraMotion=null;m.done?.();}
}
function pointInPolygon(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function hitSector(x,y){return !systemMode?sectorSurfaces.filter(s=>pointInPolygon(x,y,s.points)).sort((a,b)=>a.depth-b.depth)[0]:null;}
function focusSector(surface){
 if(!surface)return;cancelCamera(true);clearLocationSelection();focusedSectorId=surface.member.id;
 const g=memberGrid(surface.member),extent=Math.max(g.maxX-g.minX,g.maxY-g.minY)+3,targetZoom=Math.max(1,Math.min(5,bounds().extent/extent));
 animateCamera({focus:{x:(g.minX+g.maxX)/2,y:(g.minY+g.maxY)/2,z:0},zoom:targetZoom,panX:0,panY:0});toast('Focused on '+sectorName(surface.member.sector));
}
function unfocusSector(){
 if(systemMode||!clusterOf(data)||!focusedSectorId)return;
 cancelCamera(true);focusedSectorId=null;const b=bounds();
 animateCamera({focus:{x:b.cx,y:b.cy,z:0},zoom:1,panX:0,panY:0});
}
function nodeBounds(list){if(!list.length)return {cx:0,cy:0,extent:8};const xs=list.map(n=>Number(n.x)),ys=list.map(n=>Number(n.y));return {cx:(Math.min(...xs)+Math.max(...xs))/2,cy:(Math.min(...ys)+Math.max(...ys))/2,extent:Math.max(8,Math.max(...xs)-Math.min(...xs)+2,Math.max(...ys)-Math.min(...ys)+2)};}
function bounds(){return systemMode?{cx:0,cy:0,extent:localExtent}:mapBoundsCache||nodeBounds(nodes);}
// Positive pitch views the grid from above: the camera lies along +ry/+Z.
// Distance increases away from that camera, so both perspective and occlusion
// use the negative dot product with the camera-facing direction.
function project(x,y,z=0){const b=bounds(),focus=cameraFocus||{x:b.cx,y:b.cy,z:0},X=(x-focus.x),Y=(y-focus.y),Z=(z-(focus.z||0))*spread,rx=X*Math.cos(yaw)-Y*Math.sin(yaw),ry=X*Math.sin(yaw)+Y*Math.cos(yaw),vertical=ry*Math.sin(pitch)-Z*Math.cos(pitch),depth=-(ry*Math.cos(pitch)+Z*Math.sin(pitch)),scale=Math.min(w*.069,h*.105)*zoom*(10/b.extent),persp=16/Math.max(4,16+depth*.48*(clusterOf(data)&&!systemMode?10/b.extent:1));return {x:w*.50+rx*scale*persp+panX,y:h*.50+vertical*scale*persp+panY,s:persp,d:depth,unitScale:scale*persp}}
function focusNode(n){cancelCamera(true);panX=0;panY=0;zoom=Math.max(zoom,1.25);const p=project(n.x,n.y,n.z);panX=w*.5-p.x;panY=h*.5-p.y;dirty=true;toast('Focused on '+n.name)}
const stellarClasses={O:{label:'Blue',color:'#91b6ff'},B:{label:'Blue-white',color:'#b1cdff'},A:{label:'White',color:'#e6edff'},F:{label:'Yellow-white',color:'#fff2d2'},G:{label:'Yellow',color:'#ffda85'},K:{label:'Orange',color:'#ffb277'},M:{label:'Red',color:'#ff886a'}};
function stellar(n){if(n.type==='blackHole')return {key:'BH',label:'Black hole',color:'#be9aec'};const roll=hash('spectral:'+n.id)%100,key=saved[n.id]?.stellarClass|| (roll<35?'M':roll<60?'K':roll<75?'G':roll<85?'F':roll<93?'A':roll<99?'B':'O');return {key,...(stellarClasses[key]||stellarClasses.G)}}
function localColor(n){if(n.id===selected?.id)return stellar(selected).color;if(n.type==='planet'){const a=n.attributes||{},t=String(a.atmosphere||'').toLowerCase();return t.includes('breathable')?'#7dc5c8':t.includes('corrosive')?'#d8be7d':['#99afca','#c78f76','#c9b08e','#96ad82'][hash(n._sourceId||n.id)%4]}if(n.type==='driftGate')return '#8ce7e6';if(n.type==='moon')return '#adb7c3';if(n.type==='asteroidBelt')return '#b69f88';if(n.type.toLowerCase().includes('ruin'))return '#bb9dce';return '#8ee5cf'}
function makeLocalLayout(){localBodies=[{...selected,x:0,y:0,z:0,localStar:true}];const direct=children(selected).sort((a,b)=>(a.type==='planet'?0:a.type==='asteroidBelt'?1:2)-(b.type==='planet'?0:b.type==='asteroidBelt'?1:2)||a.name.localeCompare(b.name));
 function addChildren(parent,depth=0,seen=new Set()){if(depth>6||seen.has(parent.id))return;seen=new Set(seen).add(parent.id);const cs=children(parent);cs.forEach((c,i)=>{const angle=(i/Math.max(1,cs.length))*Math.PI*2+hash(c._sourceId||c.id)%100/50,r=.64+depth*.17+i*.18;const body={...c,x:parent.x+Math.cos(angle)*r,y:parent.y+Math.sin(angle)*r,z:.08*(depth+1),orbitRadius:r,orbitParent:parent.id,depth:depth+1};localBodies.push(body);addChildren(body,depth+1,seen)})}
 direct.forEach((c,i)=>{const r=1.65+i*1.2,angle=(hash(c._sourceId||c.id)%628)/100;const body={...c,x:Math.cos(angle)*r,y:Math.sin(angle)*r,z:0,orbitRadius:r,orbitParent:selected.id,depth:0};localBodies.push(body);addChildren(body)});
 const gateRadius=Math.max(3,...localBodies.map(n=>Math.hypot(n.x,n.y,n.z)))+1.4;localBodies.push(...buildSystemGates(selected,nodes.filter(visible),laneEdges,gateRadius));localExtent=Math.max(10,...localBodies.map(n=>Math.hypot(n.x,n.y,n.z)*2+2));
}
function enterSystem(id,animated=true){
 if(entryState)return;const n=nodes.find(a=>a.id===id);if(!n)return;cancelCamera();if(!systemMode)sectorCamera=cameraState();
 if(animated===false||systemMode||reducedMotion()){enterSystemNow(id);return;}
 selected=n;armedSystemId=null;if(routeOpen)closeRoute();setExplorerOpen(false);$('#dossier').hidden=true;document.body.classList.remove('has-selection');entryState={id,phase:'approach',progress:0};document.body.classList.add('entering-system');canvas.dataset.transition='enter-system';canvas.setAttribute('aria-busy','true');$('#entry-caption').textContent='Entering '+n.name+'…';$('#entry-caption').hidden=false;
 animateCamera({focus:{x:Number(n.x),y:Number(n.y),z:n.z},zoom:Math.min(14,Math.max(4,zoom*4)),panX:0,panY:0},460,()=>{
  enterSystemNow(id);entryState.phase='arrival';entryState.progress=0;zoom=3.4;cameraFocus={x:0,y:0,z:0};animateCamera({focus:{x:0,y:0,z:0},zoom:1,panX:0,panY:0},420,finishEntry);
 });
}
function enterSystemNow(id){armedSystemId=null;document.body.classList.remove('has-selection');const n=nodes.find(a=>a.id===id);if(!n)return;selected=n;systemMode=true;bodySelected=n;closeRoute();makeLocalLayout();reset(true);pitch=.95;document.body.classList.add('in-system');$('#back-sector').hidden=false;$('#local-objects').hidden=false;$('#system-heading').hidden=false;$('#system-title').textContent=n.name;$('#system-subtitle').textContent=`${stellar(n).label}${n.type==='blackHole'?'':' · Class '+stellar(n).key} · ${localBodies.filter(n=>!n.localStar&&!n.generated).length} objects · ${localBodies.filter(n=>n.type==='driftGate').length} gates`;$('#panel-heading').textContent='SYSTEM CONTENTS';$('#search').placeholder='Find a planet, moon, station…';$('#map-mode').textContent='SYSTEM ORBITS';$('#show-systems').textContent='Objects';$('#show-layers').hidden=true;showSystems();$('#local-note').hidden=false;setExplorerOpen(innerWidth>800);renderList();renderDossier();if(innerWidth<=800){setExplorerOpen(false);$('#dossier').classList.remove('mobile-open')}dirty=true;}
function leaveSystem(){cancelCamera(true);if(!systemMode)return;if(routeOpen)closeRoute();localRoute=false;armedSystemId=null;document.body.classList.remove('has-selection');systemMode=false;bodySelected=null;document.body.classList.remove('in-system');$('#back-sector').hidden=true;$('#local-objects').hidden=true;$('#system-heading').hidden=true;$('#local-note').hidden=true;$('#panel-heading').textContent='EXPLORER';$('#search').placeholder='Find a system or world…';$('#show-systems').textContent='Systems';$('#show-layers').hidden=false;search='';$('#search').value='';if(sectorCamera)restoreCamera(sectorCamera);$('#view3d').classList.toggle('active',!topView);$('#view2d').classList.toggle('active',topView);$('#map-mode').textContent=topView?'TOP-DOWN VIEW':'PERSPECTIVE VIEW';$('#dossier').classList.remove('mobile-open');renderList();renderDossier();dirty=true;}
function renderLocalList(){const list=localBodies.filter(n=>!search||n.name.toLowerCase().includes(search));$('#system-list').innerHTML=list.length?list.map(n=>`<button class="system-row local-row ${bodySelected?.id===n.id?'selected':''}" data-body="${esc(n.id)}" ${n.type==='driftGate'?`data-gate-to="${esc(n.linkTo)}" title="Bidirectional Drift gate to ${esc(nodes.find(a=>a.id===n.linkTo)?.name)}"`:""}><canvas class="object-thumb" width="64" height="64" data-model-id="${esc(n.id)}" aria-hidden="true"></canvas><span>${esc(n.name)}<small>${n.localStar?(n.type==='blackHole'?'SINGULARITY':'CENTRAL STAR'):esc(n.type==='driftGate'?'ENTRANCE / EXIT':typeName(n.type))}</small></span><span class="count">${n.type==='planet'?'●':n.type==='moon'?'○':n.localStar?'✧':'◇'}</span></button>`).join(''):'<p class="empty">No matching objects.</p>';$$('[data-model-id]').forEach(c=>{const n=localBodies.find(a=>a.id===c.dataset.modelId),g=c.getContext('2d');if(n.localStar){const gradient=g.createRadialGradient(26,24,1,32,32,15);gradient.addColorStop(0,'#fff5d4');gradient.addColorStop(1,stellar(selected).color);g.fillStyle=gradient;g.beginPath();g.arc(32,32,15,0,7);g.fill()}else drawObjectModel(g,visualNode(n),32,32,11,{yaw:.65,pitch:.5})});$$('[data-body]').forEach(b=>b.onclick=()=>{selectBody(b.dataset.body);focusNode(localBodies.find(n=>n.id===b.dataset.body));});}
function selectBody(id){if(routeOpen)closeRoute();const n=localBodies.find(n=>n.id===id);if(!n)return;bodySelected=n;renderLocalList();renderDossier();if(innerWidth<=800){$('#dossier').classList.add('mobile-open');setExplorerOpen(false)}dirty=true;}

function clearLocationSelection(){if(routeOpen)return;armedSystemId=null;bodySelected=null;if(!systemMode)selected=null;document.body.classList.remove('has-selection');$('#dossier').hidden=true;$('#dossier').classList.remove('mobile-open');if(modelObserver){modelObserver.disconnect();modelObserver=null;}renderList();dirty=true;}
// Location controls select/reselect directly; other UI surfaces dismiss the
// current details. The map handles its own tap so drags never clear selection.
document.addEventListener('click',e=>{
 const path=e.composedPath(),inPath=selector=>path.some(el=>el instanceof Element&&el.matches(selector));
 if(inPath('#main-menu,#factions-dialog,#sectors-dialog,#cluster-dialog,#help-dialog,#space'))return;
 if(!inPath('#explorer,nav button[data-tab="catalog"],#local-objects'))setExplorerOpen(false);
 if(routeOpen&&!inPath('#route-panel,nav button[data-tab="route"],#navigate,#body-destination,#body-departure,#gate-lane'))closeRoute();
 if(entryState||inPath('#dossier,#route-panel,#selection-card,.system-row,#sectors'))return;
 clearLocationSelection();
});

function visualNode(n){return {...n,visualKind:saved[n.id]?.modelKind};}
let modelObserver=null;
function attachModelViewer(n){if(modelObserver)modelObserver.disconnect();const c=$('#object-model');if(!c)return;let ry=.5,rx=.5,down=null;const g=c.getContext('2d');
 function paint(){const width=c.clientWidth,height=c.clientHeight,scale=Math.min(devicePixelRatio||1,2);c.width=width*scale;c.height=height*scale;g.setTransform(scale,0,0,scale,0,0);g.clearRect(0,0,width,height);const k=modelKind(visualNode(n)),extent=modelExtent(visualNode(n)),r=Math.min(width*.38,height*.39)/Math.max(1,extent*.78);drawObjectModel(g,visualNode(n),width/2,height/2-3,r,{yaw:ry,pitch:rx});}
 c.onpointerdown=e=>{c.setPointerCapture(e.pointerId);down={x:e.clientX,y:e.clientY}};c.onpointermove=e=>{if(!down)return;ry+=(e.clientX-down.x)*.012;rx=Math.max(-1.5,Math.min(1.5,rx+(e.clientY-down.y)*.012));down={x:e.clientX,y:e.clientY};paint()};c.onpointerup=c.onpointercancel=()=>down=null;modelObserver=new ResizeObserver(paint);modelObserver.observe(c);paint();
}

function renderBodyDossier(){const n=bodySelected,parent=all.find(a=>a.id===n.parent&&a.type===n.parentEntity);$('#dossier').innerHTML=`<div class="panel-title">OBJECT DOSSIER <button class="iconbtn" id="close-body" aria-label="Close location details">×</button></div><div class="dossier-hero model-hero"><canvas id="object-model" aria-label="${esc(modelInfo(visualNode(n))[0])}. Drag to rotate the model."></canvas><span class="hero-label">DRAG TO ROTATE · ${esc(modelInfo(visualNode(n))[0]).toUpperCase()}</span></div><div class="dossier-body"><span class="badge">${esc(typeName(n.type))} / ${n.generated?'LANE CONNECTION':n.isHidden?'HIDDEN':'CATALOGUED'}</span><h2>${esc(n.name)}</h2>${factions.details(n)}${simulation.details(n.id)}<p class="help">${esc(selected.name)}${parent&&parent.id!==selected.id?' / '+esc(parent.name):''}</p><button class="primary" id="body-destination">⌁ Set as destination</button><button class="secondary" id="body-departure">Set as departure</button>${n.type==='driftGate'?`<button class="secondary gate-action" id="gate-lane">→ Plot lane to ${esc(nodes.find(a=>a.id===n.linkTo)?.name||'connected system')}</button>`:""}<button class="secondary" id="center-body">⊙ Center on object</button><div class="model-description"><b>${esc(modelInfo(visualNode(n))[0])}</b><p>${esc(modelInfo(visualNode(n))[1])}</p></div>${n.type==='planet'?`<label class="field">PLANET APPEARANCE<select id="surface-model"><option value="">Automatic · from survey</option>${Object.entries(surfaceTypes).map(([k,v])=>`<option value="${k}" ${saved[n.id]?.modelKind===k?"selected":""}>${v}</option>`).join("")}</select></label>`:""}<div class="subheading">${n.generated?'LANE GATE RECORD':'SURVEY RECORD'}</div>${entityHTML(n)}<p class="help">Select the record above to read its attributes and any attached facilities.</p><button id="star-dossier" class="secondary">← Back to central star</button></div>`;$('#body-destination').onclick=()=>setLocalEndpoint(n.id,'to');$('#body-departure').onclick=()=>setLocalEndpoint(n.id,'from');if($('#gate-lane'))$('#gate-lane').onclick=()=>{const from=selected.id,to=n.linkTo;leaveSystem();openRoute();$('#from').value=from;$('#to').value=to;$('#profile').value='lane';renderRoute();rememberRoute();plotCourse()};attachModelViewer(n);if($('#surface-model')&&modelKind({...n,visualKind:null})==='ecumenopolis'){$('#surface-model').value='ecumenopolis';$('#surface-model').disabled=true;$('#surface-model').title='TL5 worlds are ecumenopolises';}if($('#surface-model'))$('#surface-model').onchange=e=>{saved[n.id]={...saved[n.id],modelKind:e.target.value};persist();renderLocalList();renderBodyDossier();dirty=true};$('#dossier .world').open=true;$('#center-body').onclick=()=>focusNode(n);$('#close-body').onclick=clearLocationSelection;$('#star-dossier').onclick=()=>selectBody(selected.id);}
function drawOrbit(cx,cy,r,color,width=1){let prev;for(let i=0;i<=100;i++){const a=i/100*Math.PI*2,p=project(cx+Math.cos(a)*r,cy+Math.sin(a)*r,0);if(prev)line(prev,p,color,width);prev=p}}
function gateRole(n){if(n.type!=='driftGate'||!plottedCourse||plottedCourse.local||plottedCourse.key!=='lane')return '';const i=plottedCourse.path.indexOf(selected.id);return i<0?'':plottedCourse.path[i+1]===n.linkTo?'EXIT':plottedCourse.path[i-1]===n.linkTo?'ENTRANCE':'';}
function drawGateDirections(){for(const n of localBodies.filter(n=>n.type==='driftGate')){if(projected.find(p=>p.n.id===n.id)?.hidden)continue;const color=gateRole(n)?'#edc27a':'#71c9cf88',a=project(n.x*.88,n.y*.88,n.z*.88),b=project(n.x*1.10,n.y*1.10,n.z*1.10);line(a,b,color,1,[3,4]);for(const [p,q]of [[a,b],[b,a]]){const angle=Math.atan2(p.y-q.y,p.x-q.x);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-Math.cos(angle-.45)*5,p.y-Math.sin(angle-.45)*5);ctx.lineTo(p.x-Math.cos(angle+.45)*5,p.y-Math.sin(angle+.45)*5);ctx.closePath();ctx.fillStyle=color;ctx.fill();}}}
function drawSystem(){const labelBoxes=[];function placeLabel(p,r,n){const text=n.name;ctx.font=(n.localStar?'500 14px':'10px')+' "DM Sans",sans-serif';const width=Math.max(ctx.measureText(text).width,70)+6;const candidates=[{x:p.x+r+10,y:p.y-9},{x:p.x+r+10,y:p.y+18},{x:p.x-width-r-10,y:p.y-9},{x:p.x-width/2,y:p.y-r-38},...Array.from({length:5},(_,i)=>({x:p.x+r+10,y:p.y-38-i*26})),...Array.from({length:5},(_,i)=>({x:p.x+r+10,y:p.y+42+i*26}))].map(b=>({x:Math.max(8,Math.min(w-width-8,b.x)),y:Math.max(w<=800?160:8,Math.min(h-150,b.y))}));const score=b=>labelBoxes.reduce((sum,a)=>sum+Math.max(0,Math.min(b.x+width,a.x+a.w)-Math.max(b.x,a.x))*Math.max(0,Math.min(b.y+28,a.y+a.h)-Math.max(b.y,a.y)),0);candidates.sort((a,b)=>score(a)-score(b));const box={...candidates[0],w:width,h:28};labelBoxes.push(box);return box;}const spectral=stellar(selected),center=project(0,0,0),glow=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,Math.min(w,h)*.5);glow.addColorStop(0,spectral.color+'15');glow.addColorStop(1,spectral.color+'00');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
 for(const n of localBodies){if(n.localStar||n.type==='driftGate')continue;const parent=localBodies.find(a=>a.id===n.orbitParent);if(!parent)continue;if(n.depth===0)drawOrbit(parent.x,parent.y,n.orbitRadius,n.type==='asteroidBelt'?'#b3a08626':'#7595a230');else if(n.type==='moon')drawOrbit(parent.x,parent.y,n.orbitRadius,'#7595a21c');if(n.type==='asteroidBelt'){for(let j=0;j<160;j++){const a=(hash(n.id+j)%6283)/1000,r=n.orbitRadius+(hash('r'+n.id+j)%100-50)*.004,p=project(Math.cos(a)*r,Math.sin(a)*r,0);ctx.fillStyle='#ae9c8266';ctx.fillRect(p.x,p.y,1.4,1.4)}}}
 const assetScale=Math.max(.62,Math.min(1,Math.min(w,h)/650));
 projected=localBodies.map(n=>{
  const p={...project(n.x,n.y,n.z),n},baseRadius=n.localStar?28:n.type==='planet'?(modelKind(visualNode(n))==='gas'?18:16):n.type==='moon'?5.5:n.type==='asteroidBelt'?4:n.type==='driftGate'?5:3;
  p.r=baseRadius*assetScale*p.s*Math.sqrt(zoom);if(n.localStar)p.paintKey=`local-star:${n.type}:${localColor(n)}:${p.r}`;p.bodyExtent=n.localStar?(n.type==='blackHole'?p.r*1.75:p.r):p.r*modelExtent(visualNode(n));p.hitRadius=Math.max(14,p.bodyExtent+6);return p;
 });
 projected=depthRenderer.prepare(projected,{width:w,height:h,scale:dpr},(g,p)=>{
  const n=p.n,r=p.r,black=n.localStar&&n.type==='blackHole';
  if(n.localStar){const gradient=g.createRadialGradient(p.x-r*.35,p.y-r*.4,0,p.x,p.y,r);gradient.addColorStop(0,'#fff9ee');gradient.addColorStop(.45,localColor(n));gradient.addColorStop(1,localColor(n));g.fillStyle=black?'#050810':gradient;g.beginPath();g.arc(p.x,p.y,r,0,Math.PI*2);g.fill();if(black){g.strokeStyle=localColor(n);g.lineWidth=2;g.stroke();g.beginPath();g.ellipse(p.x,p.y,r*1.7,r*.45,-.25,0,Math.PI*2);g.stroke();}}
  else drawObjectModel(g,visualNode(n),p.x,p.y,r,{yaw:n.type==='driftGate'?-yaw:yaw+.5,pitch:n.type==='driftGate'?-pitch:pitch});
 });
 drawGateDirections();drawCourse();
 for(const p of projected){
  if(p.hidden)continue;const n=p.n,r=p.r,extent=p.bodyExtent,sel=bodySelected?.id===n.id,color=localColor(n),black=n.localStar&&n.type==='blackHole';
  if(n.localStar){const g=ctx.createRadialGradient(p.x,p.y,r*.4,p.x,p.y,r*5);g.addColorStop(0,color+'80');g.addColorStop(.35,color+'20');g.addColorStop(1,color+'00');ctx.fillStyle=g;ctx.fillRect(p.x-r*5,p.y-r*5,r*10,r*10);}
  depthRenderer.draw(ctx,p);
  if(document.querySelector('[data-faction-toggle]').checked){const catalog=factionCatalog(data),owners=locationOwners(saved[n.id],catalog);for(let i=0;i<owners.length;i++){ctx.strokeStyle=catalog[owners[i]].color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,extent+3,i*Math.PI*2/owners.length,(i+1)*Math.PI*2/owners.length);ctx.stroke();}}
  if(sel||gateRole(n)){ctx.strokeStyle='#e3c38c';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(p.x,p.y,extent+7,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
  if($('#labels').checked||sel||n.localStar){ctx.fillStyle=sel?'#f4deb5':'#b1c4cd';ctx.font=(n.localStar?'500 14px':'10px')+' "DM Sans",sans-serif';ctx.shadowColor='#080e17';ctx.shadowBlur=6;const label=placeLabel(p,extent,n);if(Math.abs(label.y-p.y)>18)line(p,{x:label.x-4,y:label.y+10},'#7b9da34a',.6);ctx.fillText(n.name,label.x,label.y+12);ctx.font='7px "IBM Plex Mono",monospace';ctx.fillStyle=color;ctx.fillText(n.localStar?(black?'BLACK HOLE':'CLASS '+spectral.key+' STAR'):n.type==='driftGate'?'DRIFT GATE · '+(gateRole(n)||'IN / OUT'):typeName(n.type).toUpperCase(),label.x,label.y+25);ctx.shadowBlur=0;}
 }
}

$('#back-sector').onclick=leaveSystem;$('#local-objects').onclick=()=>{if(routeOpen)closeRoute();setExplorerOpen(!explorerIsOpen());$('#dossier').classList.remove('mobile-open');$('#search').focus()};
$('.brand').onclick=e=>{e.preventDefault();leaveSystem()};

const stars=Array.from({length:950},(_,i)=>({x:(hash('x'+i)%10000)/10000,y:(hash('y'+i)%10000)/10000,r:.3+(hash('r'+i)%100)/130,a:.12+(hash('a'+i)%100)/250}));
function line(a,b,color,width=1,dash=[]){ctx.beginPath();ctx.setLineDash(dash);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();ctx.setLineDash([])}
const gridColors=['#79dbcf','#dcb77c','#98b9f2','#d5a3df','#9bd19b','#e5a088'];
function drawClusterGrids(){
 const meta=clusterOf(data);sectorSurfaces=[];if(!meta)return;
 meta.members.forEach((m,index)=>{const g=memberGrid(m),color=gridColors[index%gridColors.length],corners=[[g.minX,g.minY],[g.maxX,g.minY],[g.maxX,g.maxY],[g.minX,g.maxY]].map(([x,y])=>project(x,y)),step=Math.max(1,Math.ceil(Math.max(g.maxX-g.minX,g.maxY-g.minY)/80));
  sectorSurfaces.push({member:m,points:corners,depth:corners.reduce((sum,p)=>sum+p.d,0)/4});
  if($('#grid').checked){
   ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=color+'05';ctx.fill();
   for(let x=g.minX;x<=g.maxX+.001;x+=step)line(project(x,g.minY),project(x,g.maxY),color+'24');for(let y=g.minY;y<=g.maxY+.001;y+=step)line(project(g.minX,y),project(g.maxX,y),color+'24');
   for(let i=0;i<4;i++)line(corners[i],corners[(i+1)%4],color+(focusedSectorId===m.id?'ff':'aa'),focusedSectorId===m.id?2.3:1.3);
  }
  if($('#labels').checked){const label=project(g.minX,g.minY);ctx.textAlign='left';ctx.font='600 10px "DM Sans",sans-serif';ctx.fillStyle=color;ctx.shadowColor='#080e17';ctx.shadowBlur=5;ctx.fillText(sectorName(m.sector),label.x+4,label.y-8);ctx.shadowBlur=0;}
 });
}
function factionNameOpacity(){
 // Fade by camera zoom, not projected label size, so rotating never flickers
 // the names. Cluster detail zoom is the scale at which one sector fills view.
 const meta=clusterOf(data);let detailZoom=3;
 if(meta?.members.length>1){const members=focusedSectorId?meta.members.filter(m=>m.id===focusedSectorId):meta.members,extents=members.map(m=>{const g=memberGrid(m);return Math.max(g.maxX-g.minX,g.maxY-g.minY)+3;}).sort((a,b)=>a-b);detailZoom=Math.min(3,bounds().extent/extents[Math.floor(extents.length/2)]);}
 const end=Math.max(1.2,detailZoom),start=Math.max(1.05,end*.7),t=Math.max(0,Math.min(1,(zoom-start)/(end-start)));
 return 1-t*t*(3-2*t);
}
function draw(){if(!dirty)return;dirty=false;updateCourseSummary();ctx.clearRect(0,0,w,h);ctx.fillStyle='#080e17';ctx.fillRect(0,0,w,h);
 const nebula=ctx.createRadialGradient(w*.54,h*.44,0,w*.54,h*.44,w*.55);nebula.addColorStop(0,'#183d4329');nebula.addColorStop(.5,'#17274218');nebula.addColorStop(1,'#080e1700');ctx.fillStyle=nebula;ctx.fillRect(0,0,w,h);
 for(const s of stars){ctx.globalAlpha=s.a;ctx.fillStyle=['#cadbff','#fff1d0','#ffcaab','#ffffff'][Math.floor(s.x*100)%4];ctx.beginPath();ctx.arc((s.x*w+yaw*12+w)%w,(s.y*h+pitch*5+h)%h,s.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
 if(systemMode){drawSystem();return;}
 const b=bounds();if(clusterOf(data)){drawClusterGrids();}else{const b=bounds();if($('#grid').checked){const cols=Math.min(60,Math.ceil(b.extent/2)+2);for(let i=-cols;i<=cols;i++){line(project(b.cx+i,b.cy-cols,0),project(b.cx+i,b.cy+cols,0),'#54748618');line(project(b.cx-cols,b.cy+i,0),project(b.cx+cols,b.cy+i,0),'#54748618')}ctx.font='8px "IBM Plex Mono",monospace';ctx.fillStyle='#46616e';for(let i=-cols;i<=cols;i+=2){const p=project(b.cx+i,b.cy+cols);ctx.fillText(String(i),p.x,p.y+10)}}}

 const factionLabels=factions.draw(ctx,project,visible,factionNameOpacity());
 const activeCourse=routeOpen?courseFromInfo(routeInfo()):plottedCourse;const ns=nodes.filter(n=>visible(n)&&(matches(n)||(!activeCourse?.local&&activeCourse?.path.includes(n.id))));projected=ns.map(n=>{const p={...project(n.x,n.y,n.z),n},approach=entryState?.phase==='approach'&&entryState.id===n.id?1+entryState.progress*16:1;p.r=(n.type==='blackHole'?5:3.2)*p.s*approach;p.paintKey=`sector-star:${n.type}:${stellar(n).color}:${p.r}`;p.bodyExtent=p.r+2;return p;});
 projected=depthRenderer.prepare(projected,{width:w,height:h,scale:dpr},(g,p)=>{g.fillStyle=p.n.type==='blackHole'?'#090d19':stellar(p.n).color;g.beginPath();g.arc(p.x,p.y,p.r,0,Math.PI*2);g.fill();if(p.n.type==='blackHole'){g.strokeStyle=stellar(p.n).color;g.lineWidth=1.5;g.stroke();}});
 if($('#links').checked){const byId=new Map(nodes.map(n=>[n.id,n]));for(const [aid,bid]of laneEdges){const a=byId.get(aid),b=byId.get(bid);if(visible(a)&&visible(b))line(project(a.x,a.y,a.z),project(b.x,b.y,b.z),a._clusterMember&&a._clusterMember!==b._clusterMember?'#dfb877bb':'#70a2ac35',a._clusterMember&&a._clusterMember!==b._clusterMember?1.8:1);}}
 drawCourse();
 const labelBoxes=(factionLabels||[]).map(l=>({x:l.x-l.width/2-4,y:l.y-l.height/2-4,w:l.width+8,h:l.height+8}));
 for(const p of projected){if(p.hidden)continue;const n=p.n,sel=selected?.id===n.id,black=n.type==='blackHole',color=stellar(n).color;if($('#stems').checked&&Math.abs(n.z*spread)>.1&&!topView){const base=project(n.x,n.y,0);line(base,p,sel?'#c1ad7055':'#6caeb031',.7,[2,4]);ctx.strokeStyle='#597b8144';ctx.beginPath();ctx.ellipse(base.x,base.y,3,1.5,0,0,7);ctx.stroke()}
 const radius=p.r,g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,radius*7);g.addColorStop(0,color+'70');g.addColorStop(.25,color+'15');g.addColorStop(1,color+'00');ctx.fillStyle=g;ctx.fillRect(p.x-radius*7,p.y-radius*7,radius*14,radius*14);depthRenderer.draw(ctx,p);
 const factionColors=factions.colors(n.id);if(factionColors.length){ctx.lineWidth=2.5;for(let i=0;i<24;i++){ctx.strokeStyle=factionColors[i%factionColors.length];ctx.beginPath();ctx.arc(p.x,p.y,radius+5,i*Math.PI/12,(i+1)*Math.PI/12);ctx.stroke();}}
 if(sel){ctx.strokeStyle='#e4bd7b90';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,14*p.s,0,7);ctx.stroke();ctx.beginPath();ctx.arc(p.x,p.y,19*p.s,.1,1.2);ctx.arc(p.x,p.y,19*p.s,3.2,4.3);ctx.stroke();}
 if($('#labels').checked||sel){ctx.font=`${sel?'500':'400'} ${sel?12:10}px "DM Sans",sans-serif`;ctx.textAlign='left';ctx.fillStyle=sel?'#f0dab5':black?'#b6a3cf':'#9fb7c3';ctx.shadowColor='#080e17';ctx.shadowBlur=5;const lx=p.x+12*p.s,ly=p.y+3,box={x:lx-2,y:ly-11,w:ctx.measureText(n.name).width+6,h:14};const labelFits=!clusterOf(data)||sel||!labelBoxes.some(a=>box.x<a.x+a.w&&box.x+box.w>a.x&&box.y<a.y+a.h&&box.y+box.h>a.y);if(labelFits){ctx.fillText(n.name,lx,ly);labelBoxes.push(box);}if(sel){ctx.font='7px "IBM Plex Mono",monospace';ctx.fillStyle='#b19b76';ctx.fillText('SELECTED SYSTEM',p.x+12*p.s,p.y+17)}ctx.shadowBlur=0}}
 // Political names are a final overlay, above bodies, rings and system text.
 factions.drawLabels(ctx);
}
function resize(){w=canvas.clientWidth;h=canvas.clientHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);dirty=true}new ResizeObserver(resize).observe(canvas);
function hitTest(x,y){
 const visible=projected.filter(p=>!p.hidden),surfaceHits=visible.filter(p=>depthRenderer.alphaAt(p,x,y)>=128).sort((a,b)=>a.d-b.d||String(b.n.id).localeCompare(String(a.n.id)));
 if(surfaceHits.length)return surfaceHits[0];
 return visible.map(p=>({p,d:Math.hypot(p.x-x,p.y-y)})).filter(a=>a.d<=(a.p.hitRadius||(clusterOf(data)&&!systemMode&&focusedSectorId!==a.p.n._clusterMember?(innerWidth<=800?8:12):18))).sort((a,b)=>a.d-b.d||a.p.d-b.p.d)[0]?.p;
}
const pointers=new Map();let drag=null,pinch=null;
canvas.onpointerdown=e=>{cancelCamera(true);canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,pan:e.shiftKey||e.button===2};if(pointers.size===2){const [a,b]=[...pointers.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);drag.moved=true}};
canvas.onpointermove=e=>{if(!pointers.has(e.pointerId)){const rect=canvas.getBoundingClientRect(),hit=hitTest(e.clientX-rect.left,e.clientY-rect.top)||hitSector(e.clientX-rect.left,e.clientY-rect.top);canvas.style.cursor=hit?'pointer':'grab';return}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)zoom=Math.max(.25,Math.min(5,zoom*d/pinch));pinch=d;drag.moved=true;dirty=true;return}if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)drag.moved=true;if(drag.pan||topView){panX+=dx;panY+=dy}else{yaw+=dx*.005;pitch+=dy*.005}drag.x=e.clientX;drag.y=e.clientY;dirty=true};
canvas.onpointerup=e=>{pointers.delete(e.pointerId);if(drag&&!drag.moved&&pointers.size===0&&e.button===0){dismissMapPanels();if(dirty)draw();const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,hit=hitTest(x,y);if(hit){if(systemMode)selectBody(hit.n.id);else choose(hit.n.id)}else{const sector=hitSector(x,y);if(sector)focusSector(sector);else{clearLocationSelection();unfocusSector();}}}if(!pointers.size){drag=null;pinch=null}};canvas.onpointercancel=e=>{pointers.delete(e.pointerId);drag=null;pinch=null};canvas.oncontextmenu=e=>e.preventDefault();canvas.addEventListener('wheel',e=>{e.preventDefault();cancelCamera(true);zoom=Math.max(.25,Math.min(5,zoom*Math.exp(-e.deltaY*.001)));dirty=true},{passive:false});
function frame(now){advanceCamera(now);draw();requestAnimationFrame(frame)}requestAnimationFrame(frame);
let restoredSector=null;
try{restoredSector=await sectorStore.active();}catch{toast('Saved sectors are unavailable in this browser. Use JSON export to keep your sector.');}
try{
 if(restoredSector){try{load(restoredSector.data,true);$('#data-state').textContent='SAVED ON DEVICE';}catch{restoredSector=null;toast('The last saved sector could not be opened. Loading the default.');}}
 if(!restoredSector){const response=await fetch('./sector.json');if(!response.ok)throw Error('Sector file could not be loaded.');load(await response.json());await saveCurrent();}
 await document.fonts.ready;dirty=true;
}catch(e){toast(e.message+' Use Import sector to load a file.');}finally{libraryBusy=false;}
// Notes have a synchronous local backup; flush the full snapshot when leaving the page.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&data)saveCurrent();});
