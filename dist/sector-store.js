// Large generator exports belong in IndexedDB, rather than localStorage's small quota.
export function sectorId(data) {
 if(data?._driftAtlasCluster)return 'cluster:'+data._driftAtlasCluster.id;
 const sector=Object.entries(data.sector||{}).map(([id,n])=>[id,n.name||'']).sort((a,b)=>a[0].localeCompare(b[0]));
 const systems=Object.keys(data.system||{}).sort();
 return JSON.stringify([sector,sector.length?systems:systems.map(id=>[id,data.system[id].name||''])]);
}
let connection;
function openStore() {
 if(!connection) connection=new Promise((resolve,reject)=>{
  let request,finished=false;
  const fail=()=>{if(finished)return;finished=true;clearTimeout(timer);reject(new Error('Sector storage is unavailable.'));};
  const timer=setTimeout(fail,4000);
  try {request=indexedDB.open('drift-atlas-library',1);} catch {fail();return;}
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('sectors',{keyPath:'id'});db.createObjectStore('settings');};
  request.onerror=fail;request.onblocked=fail;
  request.onsuccess=()=>{if(finished){request.result.close();return;}finished=true;clearTimeout(timer);const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
 }).catch(error=>{connection=null;throw error;});
 return connection;
}
async function transaction(mode,run) {
 const db=await openStore();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['sectors','settings'],mode);let result;
  tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Sector save failed.'));
  run(tx,value=>{result=value;});
 });
}
export const sectorStore={
 save(record,activate=true){return transaction('readwrite',tx=>{tx.objectStore('sectors').put(record);if(activate)tx.objectStore('settings').put(record.id,'active');});},
 active(){return transaction('readonly',(tx,done)=>{const req=tx.objectStore('settings').get('active');req.onsuccess=()=>{if(!req.result){done(null);return;}const item=tx.objectStore('sectors').get(req.result);item.onsuccess=()=>done(item.result||null);};});},
 get(id){return transaction('readonly',(tx,done)=>{const req=tx.objectStore('sectors').get(id);req.onsuccess=()=>done(req.result||null);});},
 list(){return transaction('readonly',(tx,done)=>{const rows=[],req=tx.objectStore('sectors').openCursor();req.onsuccess=()=>{const cursor=req.result;if(!cursor){done(rows.sort((a,b)=>b.updatedAt-a.updatedAt));return;}const {data,...summary}=cursor.value;rows.push(summary);cursor.continue();};});},
 remove(id){return transaction('readwrite',tx=>{tx.objectStore('sectors').delete(id);});}
};
