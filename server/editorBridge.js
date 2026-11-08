// Ephemeral per-login editor relay. Only project metadata and edit commands are stored.
// Video bytes remain in the user's browser. No cross-session project sharing.
import crypto from 'node:crypto';
import {previewEditorActions} from '../src/aiEditCommands.js';

const MAX_SNAPSHOT_BYTES=600_000;
const MAX_PROPOSALS=30;
const ONLINE_MS=15000;
export class EditorBridgeError extends Error {
 constructor(message,status=400){super(message);this.status=status}
}
const reject=(reason,status=400)=>{throw new EditorBridgeError(reason,status)};
const freshEditor=()=>({snapshot:null,revision:null,seenAt:0,edits:new Map()});
export function editorFor(session){
 if(!session.editor)session.editor=freshEditor();
 return session.editor;
}
export function visibleEditorSnapshot(session){
 const editor=editorFor(session);
 return {connected:Date.now()-editor.seenAt<ONLINE_MS,revision:editor.revision,project:editor.snapshot};
}
function validateProject(project){
 if(!project||project.version!==2||typeof project.name!=='string'||
 !Array.isArray(project.assets)||!Array.isArray(project.clips)||
 project.assets.length>500||project.clips.length>3000||
 !project.settings||!['16:9','9:16','1:1'].includes(project.settings.aspect)||
 !Array.isArray(project.settings.tracks)||project.settings.tracks.length>40)
  reject('Invalid project snapshot');
 if(project.assets.some(a=>!a||typeof a.id!=='string'||typeof a.name!=='string'||
  !['video','audio','image','text'].includes(a.kind)||!Number.isFinite(Number(a.duration))))
  reject('Invalid asset metadata');
 if(project.clips.some(c=>!c||typeof c.id!=='string'||typeof c.trackId!=='string'||
  typeof c.kind!=='string'||!Number.isFinite(Number(c.start))||!Number.isFinite(Number(c.outPoint))))
  reject('Invalid clip metadata');
 // JSON roundtrip removes prototype references and any non-serializable browser data.
 let payload;
 try{payload=JSON.stringify(project)}catch{reject('Cannot serialize project metadata')}
 if(payload.length>MAX_SNAPSHOT_BYTES)reject('Project metadata is too large for this preview bridge',413);
 if(/"(?:accessToken|refreshToken|clientSecret|file|url|thumbnail)"\s*:/.test(payload))
  reject('Do not submit media data or credentials to the editor bridge');
 return {payload,project:JSON.parse(payload)};
}
export function publishEditorSnapshot(session,project){
 const editor=editorFor(session),safe=validateProject(project);
 const revision=crypto.createHash('sha256').update(safe.payload).digest('hex').slice(0,32);
 if(editor.revision!==revision){
  for(const e of editor.edits.values()){
   if(e.status==='pending'&&e.baseRevision!==revision){e.status='stale';e.message='Project changed before approval. Ask the AI to prepare a fresh proposal.'}
  }
 }
 editor.snapshot=safe.project;editor.revision=revision;editor.seenAt=Date.now();
 return {revision,connected:true};
}
function publicEdit(edit,{includeActions=true}={}){
 return {id:edit.id,summary:edit.summary,status:edit.status,createdAt:edit.createdAt,
 baseRevision:edit.baseRevision,total:edit.actions.length,progress:edit.progress||0,
 steps:edit.steps,message:edit.message||'',...(includeActions?{actions:edit.actions}:{})};
}
export function proposeEditorEdits(session,{summary,actions},id=crypto.randomBytes(18).toString('base64url')){
 const editor=editorFor(session);
 if(!editor.snapshot)reject('Open AutoCaption Studio and connect its AI bridge first',409);
 if(Date.now()-editor.seenAt>=ONLINE_MS)reject('Editor browser is offline. Open AutoCaption Studio to review edits.',409);
 if([...editor.edits.values()].some(e=>['pending','applying'].includes(e.status)))reject('Finish the current edit review before proposing another batch',409);
 if(editor.edits.size>=MAX_PROPOSALS)reject('Session edit limit reached. Reconnect to start a new session',429);
 if(typeof summary!=='string'||summary.trim().length<2||summary.length>250)reject('Provide a brief edit summary (2–250 characters)');
 let plan;
 try{plan=previewEditorActions(editor.snapshot,actions)}catch(e){reject('Cannot propose edit: '+e.message)}
 const edit={id,summary:summary.trim(),actions:JSON.parse(JSON.stringify(actions)),steps:plan.steps,
  baseRevision:editor.revision,status:'pending',createdAt:Date.now(),progress:0,message:''};
 editor.edits.set(id,edit);
 return publicEdit(edit);
}
export function pendingEditorEdit(session){
 const editor=editorFor(session);
 const edit=[...editor.edits.values()].find(e=>e.status==='pending');
 return {revision:editor.revision,edit:edit?publicEdit(edit):null};
}
export function getEditorEdit(session,id){
 const edit=editorFor(session).edits.get(id);
 if(!edit)reject('Edit not found in this session',404);
 return publicEdit(edit);
}
export function reviewEditorEdit(session,id,decision){
 const editor=editorFor(session),edit=editor.edits.get(id);
 if(!edit)reject('Edit not found in this session',404);
 if(edit.status!=='pending')reject('Edit is already '+edit.status,409);
 if(decision==='reject'){
  edit.status='rejected';edit.message='Rejected in the browser';return publicEdit(edit);
 }
 if(decision!=='approve')reject('Only approve or reject decisions are allowed');
 if(editor.revision!==edit.baseRevision){
  edit.status='stale';edit.message='Project changed. Ask for a new proposal.';
  reject(edit.message,409);
 }
 edit.status='applying';edit.progress=0;
 return publicEdit(edit);
}
export function progressEditorEdit(session,id,{status,progress,message}){
 const edit=editorFor(session).edits.get(id);
 if(!edit)reject('Edit not found in this session',404);
 if(edit.status!=='applying')reject('Edit is not in progress',409);
 if(!Number.isInteger(progress)||progress<0||progress>edit.actions.length)reject('Invalid edit progress');
 if(!['applying','complete','failed'].includes(status))reject('Invalid edit status');
 if(status==='complete'&&progress!==edit.actions.length)reject('Cannot complete before all steps');
 if(status==='failed'&&(typeof message!=='string'||message.length>300))reject('Invalid failure reason');
 edit.status=status;edit.progress=progress;edit.message=status==='failed'?message||'Edit failed':status==='complete'?'Applied in the browser':'';
 return publicEdit(edit);
}
export function demoEditorEdit(session){
 const project=editorFor(session).snapshot;
 if(!project)reject('Connect the browser first',409);
 const aspect=project.settings.aspect==='9:16'?'16:9':'9:16';
 return proposeEditorEdits(session,{summary:'Demo: change canvas orientation and add a title',actions:[
  {type:'set_canvas',aspect},
  {type:'add_text',text:'AI editing in progress',start:0,duration:3,track_id:'T1'}
 ]});
}
