const DB_NAME='autocaption-studio-project-store';
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function finished(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Database transaction aborted'))})}
async function openDb(){
 if(typeof indexedDB==='undefined')throw Error('This browser does not support project storage.');
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects');if(!db.objectStoreNames.contains('media'))db.createObjectStore('media')};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
}
export async function saveBrowserProject(metadata,assets){
 const db=await openDb();
 try{
  // Store media first. If storage runs out, the existing saved project metadata remains unchanged.
  const tx=db.transaction('media','readwrite');const store=tx.objectStore('media');
  for(const a of assets)if(a.file)store.put(a.file,a.id);
  await finished(tx);
  const projectTx=db.transaction('projects','readwrite');
  projectTx.objectStore('projects').put(metadata,'current');
  await finished(projectTx);
 }finally{db.close()}
}
export async function loadBrowserProject(){
 const db=await openDb();
 try{
  const p=await request(db.transaction('projects','readonly').objectStore('projects').get('current'));
  if(!p)return null;
  const mediaTx=db.transaction('media','readonly');const settled=finished(mediaTx);const store=mediaTx.objectStore('media');
  const files=await Promise.all(p.assets.map(a=>request(store.get(a.id))));
  await settled;
  return {...p,assets:p.assets.map((a,i)=>{
   const blob=files[i]||null;
   return {...a,file:blob,url:blob?URL.createObjectURL(blob):'',missing:!blob&&a.kind!=='text'};
  })};
 }finally{db.close()}
}
