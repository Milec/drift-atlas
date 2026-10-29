import {clusterOf,createCluster,composeCluster,prepareSector,sectorName,newId,mapId,positionMember,automaticBridges,memberGrid,clusterBounds,gridsOverlap} from './clusters.js';
import {connectionConfigs,buildMemberEdit,removeClusterMember,nearbyMembers,sectorPairKey} from './cluster-edit.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=['#79dbcf','#dcb77c','#98b9f2','#d5a3df','#9bd19b','#e5a088'];
export function mountClusterManager({store,getSnapshot,save,activate,toast}){
 let working=null,candidate=null,draft=null,editingId='',source=null,isNew=false,busy=false,sourceRequest=0,lastMember=null,previewBounds=null,drag=null,states=new Map(),defaultAnchor='',sourceError='';
 const panel=$('#cluster-preview'),stars=d=>Object.entries(d.system||{}).sort((a,b)=>a[1].name.localeCompare(b[1].name));
 const peers=()=>working.members.filter(m=>m.id!==editingId);
 function setPosition(x,y){$('#cluster-x').value=String(Math.round(x*100)/100);$('#cluster-y').value=String(Math.round(y*100)/100);}
 function customPosition(){return {x:$('#cluster-x').valueAsNumber,y:$('#cluster-y').valueAsNumber};}
 function orientPairs(pairs,memberId){const ids=new Set(Object.keys(source.system).map(id=>mapId(memberId,id)));return pairs.map(e=>ids.has(e[0])?[...e]:[e[1],e[0]]);}
 function preview(meta,invalid=false){
  if(!meta?.members?.length)return;const b=drag?.bounds||clusterBounds(meta);previewBounds=b;const scale=20,vw=(b.maxX-b.minX)*scale+40,vh=(b.maxY-b.minY)*scale+40,tx=x=>20+(x-b.minX)*scale,ty=y=>20+(y-b.minY)*scale;
  let shapes='';const positions=new Map();meta.members.forEach((m,i)=>{
   const g=memberGrid(m),selected=m.id===editingId,c=selected&&invalid?'#ef9988':colors[i%colors.length];
   shapes+=`<g data-member="${esc(m.id)}" class="manager-grid ${selected?'selected-grid':''}" ${selected?'data-incoming="true"':''}><rect x="${tx(g.minX)}" y="${ty(g.minY)}" width="${(g.maxX-g.minX)*scale}" height="${(g.maxY-g.minY)*scale}" fill="${c}${selected?'28':'10'}" stroke="${c}" stroke-width="${selected?2.8:1.2}" ${selected?'stroke-dasharray="5 3"':''}/><text x="${tx(g.minX)+4}" y="${ty(g.minY)+12}" fill="${c}" font-size="9">${i+1}. ${esc(sectorName(m.sector).slice(0,25))}<title>${esc(sectorName(m.sector))} · select and drag to move</title></text>`;
   for(const [id,n]of stars(m.sector)){const x=n.x+m.x,y=n.y+m.y;positions.set(mapId(m.id,id),{x,y});shapes+=`<circle cx="${tx(x)}" cy="${ty(y)}" r="1.6" fill="${c}"><title>${esc(n.name)}</title></circle>`;}shapes+='</g>';
  });
  for(const [a,b]of meta.bridges){const x=positions.get(a),y=positions.get(b);if(x&&y)shapes+=`<line x1="${tx(x.x)}" y1="${ty(x.y)}" x2="${tx(y.x)}" y2="${ty(y.y)}" stroke="#efc47e" stroke-width="2" pointer-events="none"/>`;}
  panel.innerHTML=`<svg viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Cluster layout. Select and drag any sector grid.">${shapes}</svg><small>SELECT AND DRAG ANY GRID · ARROW KEYS MOVE THE SELECTED GRID</small>`;
 }
 function renderMembers(meta){
  $('#cluster-members').innerHTML=meta.members.map((m,i)=>`<button class="manager-member ${m.id===editingId?'active':''}" data-select-member="${esc(m.id)}" aria-pressed="${m.id===editingId}"><i style="background:${colors[i%colors.length]}"></i><span>${i+1}. ${esc(sectorName(m.sector))}<small>X ${m.x.toFixed(2)} · Y ${m.y.toFixed(2)}${isNew&&m.id===editingId?' · NEW':''}</small></span></button>`).join('');
 }
 function pairsFor(peer,count,preferred=[]){
  const from=stars(source).map(([id])=>mapId(editingId,id)),to=stars(peer.sector).map(([id])=>mapId(peer.id,id)),as=new Set(from),bs=new Set(to),out=[],seen=new Set();
  const add=e=>{if(!as.has(e[0])||!bs.has(e[1]))return;const key=JSON.stringify(e);if(!seen.has(key)){seen.add(key);out.push([...e]);}};
  for(const e of preferred)add(e);
  try{for(const e of automaticBridges(lastMember||{id:editingId,sector:source,...customPosition()},peer,'custom',Math.min(3,count)))add(e);}catch{}
  for(const a of from){for(const b of to){if(out.length>=count)break;add([a,b]);}if(out.length>=count)break;}
  return Array.from({length:count},(_,i)=>out[i]||[from[0],to[0]]);
 }
 function initializeStates(member,newSector=false){
  const configs=new Map(connectionConfigs(working).map(c=>[sectorPairKey(c.a,c.b),c]));states=new Map();
  for(const peer of peers()){const old=configs.get(sectorPairKey(editingId,peer.id));states.set(peer.id,{peer:peer.id,enabled:!!old,mode:old?.mode||'auto',count:old?.count||1,pairs:old?orientPairs(old.pairs,editingId):[],regenerate:false,lastPairs:old?orientPairs(old.pairs,editingId):[]});}
  if(newSector){const nearby=nearbyMembers(working,member),targets=nearby.length?nearby:[working.members.find(m=>m.id===$('#cluster-anchor').value)].filter(Boolean);for(const peer of targets){const state=states.get(peer.id);if(state){state.enabled=true;state.mode='auto';state.regenerate=true;}}}
 }
 function renderConnections(){
  if(!source){$('#connection-targets').innerHTML='<p class="help">Choose a sector to place before configuring connections.</p>';return;}
  const options=(member,chosen)=>stars(member.sector).map(([id,n])=>{const key=mapId(member.id,id);return `<option value="${esc(key)}" ${key===chosen?'selected':''}>${esc(n.name)}${n.isHidden?' · hidden':''}</option>`;}).join('');
  $('#connection-targets').innerHTML=peers().length?peers().map(peer=>{
   const state=states.get(peer.id),counts=[...new Set([1,2,3,state.count])].sort((a,b)=>a-b),manual=state.enabled&&state.mode==='manual';
   if(manual)state.pairs=pairsFor(peer,state.count,state.pairs);
   return `<section class="connection-card" data-peer="${esc(peer.id)}"><label class="connection-toggle"><input class="connect-peer" type="checkbox" ${state.enabled?'checked':''}><span>Connect to ${working.members.findIndex(m=>m.id===peer.id)+1}. ${esc(sectorName(peer.sector))}</span></label><div class="connection-settings" ${state.enabled?'':'hidden'}><div class="cluster-fields"><label class="field">MODE<select class="connection-mode"><option value="auto" ${state.mode==='auto'?'selected':''}>Automatic · closest edge stars</option><option value="manual" ${state.mode==='manual'?'selected':''}>Manual · choose star pairs</option></select></label><label class="field">STAR PAIRS<select class="connection-count">${counts.filter(n=>state.mode==='manual'||n<=3).map(n=>`<option value="${n}" ${n===state.count?'selected':''}>${n} pair${n===1?'':'s'}</option>`).join('')}</select></label></div>${manual?state.pairs.map((pair,i)=>`<div class="manual-pair" data-pair-index="${i}"><label class="field">${i+1}. SELECTED SECTOR<select class="pair-from" aria-label="Pair ${i+1} star in selected sector">${options(lastMember||{id:editingId,sector:source},pair[0])}</select></label><span>↔</span><label class="field">CONNECTED SECTOR<select class="pair-to" aria-label="Pair ${i+1} star in connected sector">${options(peer,pair[1])}</select></label></div>`).join(''):''}<p class="connection-summary help"></p></div></section>`;
  }).join(''):'<p class="help">Add another sector to create cross-sector connections.</p>';
 }
 function updateSummaries(meta){
  const configs=connectionConfigs(meta),byPair=new Map(configs.map(c=>[sectorPairKey(c.a,c.b),c]));
  for(const peer of peers()){const state=states.get(peer.id),cfg=byPair.get(sectorPairKey(editingId,peer.id)),card=[...document.querySelectorAll('.connection-card')].find(c=>c.dataset.peer===peer.id);if(!state.enabled||!cfg||!card)continue;state.lastPairs=orientPairs(cfg.pairs,editingId);card.querySelector('.connection-summary').textContent=state.lastPairs.map(([a,b])=>{const aid=Object.keys(source.system).find(id=>mapId(editingId,id)===a),bid=Object.keys(peer.sector.system).find(id=>mapId(peer.id,id)===b);return `${source.system[aid]?.name||'?'} ↔ ${peer.sector.system[bid]?.name||'?'}`;}).join(' · ');}
 }
 function refresh(){
  candidate=null;$('#cluster-confirm').disabled=true;if(!working)return;draft=working;
  try{
   const name=$('#builder-name').value.trim();if(!name)throw Error('Enter a cluster name.');
   if(!source){renderMembers(working);preview(working);if(sourceError)throw Error(sourceError);candidate=composeCluster({...working,name});$('#cluster-confirm').disabled=busy;$('#cluster-status').textContent='Choose a sector source to add it, or save the current cluster without adding one.';return;}
   const anchor=$('#cluster-anchor').value||editingId,direction=$('#cluster-direction').value,member=positionMember(working,source,anchor,direction,editingId,customPosition());lastMember=member;if(direction!=='custom')setPosition(member.x,member.y);draft={...working,name,members:working.members.some(m=>m.id===editingId)?working.members.map(m=>m.id===editingId?member:m):[...working.members,member]};
   draft=buildMemberEdit(working,member,[...states.values()],name);renderMembers(draft);
   const overlap=draft.members.some(m=>m.id!==editingId&&gridsOverlap(memberGrid(m),memberGrid(member)));if(overlap)throw Error('Sector grids overlap. Drag the selected grid to free space or change its offsets.');
   preview(draft);updateSummaries(draft);
   if(drag){$('#cluster-status').textContent=`Moving ${sectorName(source)} · X ${member.x.toFixed(2)} · Y ${member.y.toFixed(2)}. Release to finish placement.`;return;}
   candidate=composeCluster(draft);$('#cluster-confirm').disabled=busy;const connected=[...states.values()].filter(s=>s.enabled).length;
   $('#cluster-status').textContent=`${candidate._driftAtlasCluster.members.length} sectors · ${candidate._driftAtlasCluster.bridges.length} cross-sector lanes. Selected sector connects to ${connected} other sector${connected===1?'':'s'}. Save cluster changes to apply.`;
  }catch(e){$('#cluster-status').textContent=e.message;renderMembers(draft);preview(draft,true);}
 }
 function renderEditor(){
  $('#cluster-source-panel').hidden=!isNew;$('#cluster-editor-title').textContent=isNew?'Add a sector':`Edit ${working.members.findIndex(m=>m.id===editingId)+1}. ${sectorName(source)}`;
  const others=peers(),prior=$('#cluster-anchor').value;$('#cluster-anchor').innerHTML=others.length?others.map((m,i)=>`<option value="${esc(m.id)}">${working.members.findIndex(n=>n.id===m.id)+1}. ${esc(sectorName(m.sector))}</option>`).join(''):'<option value="">No other sector</option>';
  $('#cluster-anchor').value=others.some(m=>m.id===prior)?prior:others.some(m=>m.id===defaultAnchor)?defaultAnchor:others[0]?.id||'';
  $('#cluster-anchor').disabled=!source||!others.length;$('#cluster-direction').disabled=!source;for(const opt of $('#cluster-direction').options)opt.disabled=opt.value!=='custom'&&!others.length;
  for(const id of ['cluster-x','cluster-y','connect-nearby'])$('#'+id).disabled=!source;
  $('#cluster-remove').textContent=isNew?'Discard new sector':'Delete selected sector';$('#cluster-remove').disabled=!isNew&&working.members.length===1;$('#cluster-remove').title=!isNew&&working.members.length===1?'A cluster must contain at least one sector.':'';$('#cluster-reset-edit').disabled=!source&&!sourceError;
  renderConnections();refresh();
 }
 function commitCurrent(){
  if(source&&!candidate){$('#cluster-status').textContent='Fix the selected sector’s placement or connections, or choose Reset sector edits before switching.';return false;}
  if(candidate)working=candidate._driftAtlasCluster;return true;
 }
 function selectMember(id,commit=true){
  if(commit&&!commitCurrent())return false;const member=working.members.find(m=>m.id===id);if(!member)return false;
  sourceRequest++;isNew=false;editingId=id;source=member.sector;sourceError='';lastMember=member;defaultAnchor=working.members.find(m=>m.id!==id)?.id||'';$('#cluster-direction').value='custom';setPosition(member.x,member.y);initializeStates(member);renderEditor();return true;
 }
 function newSector(){
  if(!commitCurrent())return;defaultAnchor=working.members.some(m=>m.id===editingId)?editingId:working.members.at(-1).id;sourceRequest++;isNew=true;editingId=newId();$('#cluster-anchor').value='';source=null;sourceError='';lastMember=null;states=new Map();$('#cluster-source').value='';$('#cluster-source-name').textContent='Choose a saved sector or import a sector JSON.';$('#cluster-direction').value='right';setPosition(0,0);renderEditor();$('#cluster-editor').scrollIntoView({block:'start'});$('#cluster-source').focus({preventScroll:true});
 }
 function loadSource(data){
  source=prepareSector(data);sourceError='';lastMember=positionMember(working,source,$('#cluster-anchor').value||working.members.at(-1).id,$('#cluster-direction').value,editingId,customPosition());if($('#cluster-direction').value!=='custom')setPosition(lastMember.x,lastMember.y);initializeStates(lastMember,true);renderEditor();
 }
 $('#cluster-members').onclick=e=>{const button=e.target.closest('[data-select-member]');if(button&&button.dataset.selectMember!==editingId&&!busy)selectMember(button.dataset.selectMember);};
 $('#cluster-new').onclick=()=>{if(!busy)newSector();};
 $('#cluster-reset-edit').onclick=()=>{if(busy)return;if(isNew){source=null;sourceError='';lastMember=null;states=new Map();$('#cluster-direction').value='right';$('#cluster-source').value='';renderEditor();}else selectMember(editingId,false);};
 $('#cluster-remove').onclick=()=>{
  if(busy)return;
  if(isNew){selectMember(working.members.at(-1).id,false);return;}
  if(working.members.length===1)return;const name=sectorName(source);if(!confirm(`Remove “${name}” and its lanes from this cluster? Separate sector saves are unaffected. Changes apply when you save the cluster.`))return;
  try{working=removeClusterMember(working,editingId);selectMember(working.members[0].id,false);$('#cluster-status').textContent='Sector removed from the draft. Save cluster changes to apply, or Cancel to keep the current map.';}catch(e){$('#cluster-status').textContent=e.message;}
 };
 $('#connection-targets').onchange=e=>{
  if(busy)return;const card=e.target.closest('[data-peer]');if(!card)return;const state=states.get(card.dataset.peer),peer=working.members.find(m=>m.id===card.dataset.peer);
  if(e.target.matches('.connect-peer')){state.enabled=e.target.checked;if(state.enabled&&state.mode==='auto')state.regenerate=true;}
  else if(e.target.matches('.connection-mode')){state.mode=e.target.value;if(state.mode==='auto'){state.count=Math.min(3,state.count);state.regenerate=true;}else state.pairs=pairsFor(peer,state.count,state.lastPairs.length?state.lastPairs:state.pairs);}
  else if(e.target.matches('.connection-count')){state.count=Number(e.target.value);state.regenerate=true;if(state.mode==='manual')state.pairs=pairsFor(peer,state.count,state.pairs);}
  else if(e.target.matches('.pair-from,.pair-to')){const row=e.target.closest('[data-pair-index]');state.pairs[Number(row.dataset.pairIndex)]=[row.querySelector('.pair-from').value,row.querySelector('.pair-to').value];refresh();return;}
  renderConnections();refresh();
 };
 $('#connect-nearby').onclick=()=>{if(busy||!source||!lastMember)return;const nearby=nearbyMembers(working,lastMember);for(const peer of nearby){const state=states.get(peer.id);if(state&&!state.enabled){state.enabled=true;state.mode='auto';state.count=1;state.regenerate=true;}}renderConnections();refresh();if(!nearby.length)$('#cluster-status').textContent='No sectors are nearby. Check the sectors you want to connect to manually.';};
 $('#cluster-source').onchange=async e=>{
  if(busy||!isNew)return;const request=++sourceRequest,value=e.target.value;source=null;lastMember=null;states=new Map();sourceError=value?'Loading sector…':'';renderEditor();if(!value)return;
  try{const row=await store.get(value);if(request!==sourceRequest||!isNew)return;if(!row||row.kind==='cluster')throw Error('Choose a sector save.');loadSource(row.data);$('#cluster-source-name').textContent=sectorName(source);}catch(e){if(request!==sourceRequest||!isNew)return;sourceError=e.message;source=null;renderEditor();}
 };
 $('#cluster-import').onclick=()=>{if(!busy)$('#cluster-upload').click();};
 $('#cluster-upload').onchange=async e=>{
  const file=e.target.files[0];if(!file||busy||!isNew)return;const request=++sourceRequest;source=null;lastMember=null;states=new Map();sourceError='Loading sector…';renderEditor();
  try{if(file.size>15e6)throw Error('Choose a sector JSON smaller than 15 MB.');const next=JSON.parse(await file.text());if(request!==sourceRequest||!isNew)return;loadSource(next);$('#cluster-source').value='';$('#cluster-source-name').textContent=sectorName(source)+' · imported';}catch(e){if(request!==sourceRequest||!isNew)return;source=null;sourceError='Could not add this file: '+e.message;lastMember=null;renderEditor();}finally{e.target.value='';}
 };
 $('#cluster-anchor').onchange=()=>refresh();$('#cluster-direction').onchange=()=>{if($('#cluster-direction').value==='custom'&&lastMember)setPosition(lastMember.x,lastMember.y);refresh();};
 for(const id of ['cluster-x','cluster-y'])$('#'+id).oninput=()=>{$('#cluster-direction').value='custom';refresh();};$('#builder-name').oninput=()=>refresh();
 function beginCustom(){if(!source||!lastMember)return false;if($('#cluster-direction').value!=='custom'||!Number.isFinite($('#cluster-x').valueAsNumber)||!Number.isFinite($('#cluster-y').valueAsNumber)){setPosition(lastMember.x,lastMember.y);$('#cluster-direction').value='custom';}return true;}
 panel.onpointerdown=e=>{
  if(busy||drag||e.button!==0)return;const grid=e.target.closest('[data-member]');if(!grid)return;const svg=panel.querySelector('svg'),matrix=svg?.getScreenCTM(),bounds={...previewBounds};if(!matrix)return;
  const id=grid.dataset.member;if(id!==editingId&&!selectMember(id))return;if(!beginCustom())return;const inverse=matrix.inverse(),point=new DOMPoint(e.clientX,e.clientY).matrixTransform(inverse);
  drag={id:e.pointerId,inverse,start:point,x:lastMember.x,y:lastMember.y,bounds};panel.setPointerCapture(e.pointerId);panel.classList.add('dragging');panel.focus({preventScroll:true});e.preventDefault();refresh();
 };
 panel.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(drag.inverse);setPosition(Math.max(-10000,Math.min(10000,drag.x+(point.x-drag.start.x)/20)),Math.max(-10000,Math.min(10000,drag.y+(point.y-drag.start.y)/20)));refresh();};
 function stopDrag(e,cancel=false){if(!drag||e.pointerId!==drag.id)return;const prior=drag;drag=null;if(cancel)setPosition(prior.x,prior.y);panel.classList.remove('dragging');if(panel.hasPointerCapture(e.pointerId))panel.releasePointerCapture(e.pointerId);refresh();}
 panel.onpointerup=e=>stopDrag(e);panel.onpointercancel=e=>stopDrag(e,true);panel.onlostpointercapture=e=>stopDrag(e,true);
 panel.onkeydown=e=>{if(busy||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||!beginCustom())return;e.preventDefault();const p=customPosition(),step=e.shiftKey?2:.25;setPosition(p.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),p.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));refresh();};
 function cancel(){if(!busy){sourceRequest++;$('#cluster-dialog').close();}}
 $('#close-cluster').onclick=$('#cancel-cluster').onclick=cancel;$('#cluster-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else sourceRequest++;});
 $('#cluster-confirm').onclick=async()=>{
  if(!candidate||busy||drag)return;const result=candidate;busy=true;$('#cluster-editor').inert=true;$('#builder-name').disabled=true;$('#cluster-dialog').setAttribute('aria-busy','true');$('#cluster-confirm').disabled=true;$('#cluster-status').textContent='Saving cluster sectors and connections…';
  try{await save();const ok=await activate(result);$('#cluster-dialog').close();toast(ok?'Cluster updated. Sectors and connections saved on this device.':'Cluster updated. Export it to keep your changes; browser saving is unavailable.');}catch(e){$('#cluster-status').textContent='Could not update cluster: '+e.message;}finally{busy=false;$('#cluster-editor').inert=false;$('#builder-name').disabled=false;$('#cluster-dialog').setAttribute('aria-busy','false');$('#cluster-confirm').disabled=!candidate;}
 };
 return {async open(){
  const snapshot=getSnapshot(),map=clusterOf(snapshot)?snapshot:createCluster(snapshot);working=structuredClone(clusterOf(map));candidate=null;draft=working;busy=false;drag=null;panel.classList.remove('dragging');sourceRequest++;$('#builder-name').value=working.name;
  $('#sectors-dialog').close();$('#cluster-dialog').showModal();selectMember(working.members[0].id,false);
  try{const rows=await store.list();$('#cluster-source').innerHTML='<option value="">Choose a saved sector…</option>'+rows.filter(r=>(r.kind||'sector')==='sector').map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');}catch{$('#cluster-source').innerHTML='<option value="">No saved sectors available · import a file</option>';}
 }};
}
