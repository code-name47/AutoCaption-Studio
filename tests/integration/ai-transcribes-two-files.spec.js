import {test,expect} from '@playwright/test';

function wav(seconds=1){
 const sampleRate=16000,n=Math.round(seconds*sampleRate),data=Buffer.alloc(44+n*2);
 data.write('RIFF',0);data.writeUInt32LE(36+n*2,4);data.write('WAVE',8);
 data.write('fmt ',12);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);
 data.writeUInt16LE(1,22);data.writeUInt32LE(sampleRate,24);data.writeUInt32LE(sampleRate*2,28);
 data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);
 data.write('data',36);data.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/sampleRate)*900),44+i*2);
 return data;
}

test('MCP queues two specific imported files and the browser returns isolated timestamped transcript text',async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Stub only the heavy Whisper model output. The browser still decodes real WAV
 // media and runs its genuine job polling, claim, result, and MCP relay code.
 await page.addInitScript(()=>{
  const RealWorker=window.Worker;
  let count=0;
  window.Worker=class {
   constructor(url,options){
    if(!String(url).includes('transcription.worker'))return new RealWorker(url,options);
    this.fake=true;this.onmessage=null;this.onerror=null;
   }
   postMessage(){
    const text=++count===1?'The sonar mechanic is really interesting.':'I would love to play the full game.';
    setTimeout(()=>this.onmessage?.({data:{type:'complete',result:{
     text,segments:[{start:0.1,end:0.85,text}]
    }}}),20);
   }
   terminate(){}
  };
 });
 await page.goto('/__integration/login');
 await expect(page.locator('.ve-shell')).toBeVisible();
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles([
  {name:'reaction-a.wav',mimeType:'audio/wav',buffer:wav(1)},
  {name:'reaction-b.wav',mimeType:'audio/wav',buffer:wav(1.2)}
 ]);
 await expect(page.locator('.ve-media-item')).toHaveCount(2);
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 const sessionResponse=page.waitForResponse(r=>r.url().endsWith('/api/bridge/session')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 const {token}=await (await sessionResponse).json();
 await expect(page.getByText('Browser synced and ready')).toBeVisible();
 const rpc=async(name,args,id)=>{
  const res=await request.post('/api/bridge/mcp',{
   headers:{Authorization:'Bearer '+token},
   data:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args||{}}}
  });
  expect(res.status()).toBe(200);
  const body=await res.json();
  const result=JSON.parse(body.result.content[0].text);
  if(body.result.isError)throw Error(result.error);
  return result;
 };
 const project=await rpc('get_editor_project',{},1);
 expect(project.project.assets.map(a=>a.name)).toEqual(['reaction-a.wav','reaction-b.wav']);
 const [first,second]=project.project.assets;
 const a=await rpc('queue_transcription',{asset_id:first.id,model:'base'},2);
 expect(a.asset_id).toBe(first.id);
 await expect.poll(async()=>(await rpc('get_transcription',{job_id:a.job_id},3)).status,{timeout:20000,intervals:[600,1000,1500]}).toBe('complete');
 const transcriptA=await rpc('get_transcription',{job_id:a.job_id},4);
 expect(transcriptA.result[0].text).toBe('The sonar mechanic is really interesting.');
 expect(transcriptA.asset_id).toBe(first.id);

 // The second file is queued by ID even if the first file remains selected.
 const b=await rpc('queue_transcription',{asset_id:second.id,model:'base'},5);
 expect(b.asset_id).toBe(second.id);
 await expect.poll(async()=>(await rpc('get_transcription',{job_id:b.job_id},6)).status,{timeout:20000,intervals:[600,1000,1500]}).toBe('complete');
 const transcriptB=await rpc('get_transcription',{job_id:b.job_id},7);
 expect(transcriptB.result[0].text).toBe('I would love to play the full game.');
 expect(transcriptB.asset_id).toBe(second.id);
 const jobs=await rpc('list_transcriptions',{},8);
 expect(jobs.jobs.filter(j=>j.status==='complete').length).toBeGreaterThanOrEqual(2);
 expect(errors).toEqual([]);
 const disconnected=await page.context().request.delete('/api/bridge/session',{headers:{Authorization:'Bearer '+token}});
 expect(disconnected.ok()).toBe(true);
});


test('Existing ChatGPT connector with no-argument schema transcribes the only imported video',async({page,request})=>{
 await page.addInitScript(()=>{
  const RealWorker=window.Worker;
  window.Worker=class{
   constructor(url,opts){if(!String(url).includes('transcription.worker'))return new RealWorker(url,opts);this.onmessage=null;}
   postMessage(){setTimeout(()=>this.onmessage?.({data:{type:'complete',result:{
    text:'This is the strongest line.',segments:[{start:0.2,end:0.9,text:'This is the strongest line.'}]
   }}}),20)}
   terminate(){}
  };
 });
 await page.goto('/__integration/login');
 await expect(page.locator('.ve-shell')).toBeVisible();
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({
  name:'only-interview.wav',mimeType:'audio/wav',buffer:wav(1.5)
 });
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 const sessionResponse=page.waitForResponse(r=>r.url().endsWith('/api/bridge/session')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 const {token}=await (await sessionResponse).json();
 await expect(page.getByText('Browser synced and ready')).toBeVisible();
 const rpc=async(name,args,id)=>{
  const res=await request.post('/api/bridge/mcp',{
   headers:{Authorization:'Bearer '+token},
   data:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args||{}}}
  });
  expect(res.status()).toBe(200);
  const body=await res.json();
  const data=JSON.parse(body.result.content[0].text);
  if(body.result.isError)throw Error(data.error);
  return data;
 };
 const project=await rpc('get_editor_project',{},1);
 expect(project.project.assets).toHaveLength(1);
 // This is the EXACT call shape used by existing ChatGPT plugin installations.
 const queued=await rpc('queue_transcription',{},2);
 expect(queued.asset_id).toBe(project.project.assets[0].id);
 await expect.poll(async()=>(await rpc('get_transcription',{job_id:queued.job_id},3)).status,{timeout:20000,intervals:[600,1000,1500]}).toBe('complete');
 const transcript=await rpc('get_transcription',{job_id:queued.job_id},4);
 expect(transcript.result[0].text).toBe('This is the strongest line.');
 const disconnected=await page.context().request.delete('/api/bridge/session',{headers:{Authorization:'Bearer '+token}});
 expect(disconnected.ok()).toBe(true);
});


test('Existing ChatGPT no-argument transcription processes two imported videos in order',async({page,request})=>{
 await page.addInitScript(()=>{
  const RealWorker=window.Worker;
  window.Worker=class{
   constructor(url,opts){if(!String(url).includes('transcription.worker'))return new RealWorker(url,opts);this.onmessage=null;}
   postMessage(){setTimeout(()=>this.onmessage?.({data:{type:'complete',result:{
    text:'Great gameplay feedback.',segments:[{start:0.1,end:0.9,text:'Great gameplay feedback.'}]
   }}}),20)}
   terminate(){}
  };
 });
 await page.goto('/__integration/login');
 await expect(page.locator('.ve-shell')).toBeVisible();
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles([
  {name:'feedback-1.wav',mimeType:'audio/wav',buffer:wav(1.3)},
  {name:'feedback-2.wav',mimeType:'audio/wav',buffer:wav(1.4)}
 ]);
 await expect(page.locator('.ve-media-item')).toHaveCount(2);
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 const sessionResponse=page.waitForResponse(r=>r.url().endsWith('/api/bridge/session')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 const {token}=await (await sessionResponse).json();
 await expect(page.getByText('Browser synced and ready')).toBeVisible();
 const rpc=async(name,args,id)=>{
  const res=await request.post('/api/bridge/mcp',{
   headers:{Authorization:'Bearer '+token},
   data:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args||{}}}
  });
  expect(res.status()).toBe(200);
  const body=await res.json();
  const data=JSON.parse(body.result.content[0].text);
  if(body.result.isError)throw Error(data.error);
  return data;
 };
 const project=await rpc('get_editor_project',{},1);
 expect(project.project.assets).toHaveLength(2);
 const first=await rpc('queue_transcription',{},2);
 const second=await rpc('queue_transcription',{},3);
 expect(first.asset_id).toBe(project.project.assets[0].id);
 expect(second.asset_id).toBe(project.project.assets[1].id);
 expect(first.job_id).not.toBe(second.job_id);
 await expect.poll(async()=>[...((await rpc('list_transcriptions',{},4)).jobs||[])].filter(j=>j.status==='complete').length,{
  timeout:20000,intervals:[500,900,1300]
 }).toBe(2);
 expect((await rpc('get_transcription',{job_id:first.job_id},5)).result[0].text).toBe('Great gameplay feedback.');
 expect((await rpc('get_transcription',{job_id:second.job_id},6)).result[0].text).toBe('Great gameplay feedback.');
 const disconnected=await page.context().request.delete('/api/bridge/session',{headers:{Authorization:'Bearer '+token}});
 expect(disconnected.ok()).toBe(true);
});
