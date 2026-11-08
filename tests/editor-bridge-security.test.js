import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACKS,newClip} from '../src/editorCore.js';
import {editorProjectSnapshot} from '../src/aiEditCommands.js';
import {publishEditorSnapshot,visibleEditorSnapshot,pendingEditorEdit,proposeEditorEdits,
 getEditorEdit,reviewEditorEdit,progressEditorEdit,demoEditorEdit} from '../server/editorBridge.js';
const project=()=>editorProjectSnapshot({name:'Owner project',assets:[{id:'asset-1',name:'Private filename.mp4',kind:'video',duration:15}],
 clips:[newClip({id:'asset-1',name:'Private filename.mp4',kind:'video',duration:15},'V1',0,'clip-1')],
 settings:{aspect:'16:9',fps:30},tracks:TRACKS});
const session=()=>({ownerId:'owner',loginId:'owner-login',expires:Date.now()+60000});
test('editor snapshots and edit queues are isolated by session',()=>{
 const owner=session(),other=session();
 publishEditorSnapshot(owner,project());
 assert.equal(visibleEditorSnapshot(owner).project.name,'Owner project');
 assert.equal(visibleEditorSnapshot(other).project,null);
 const edit=proposeEditorEdits(owner,{summary:'Move the video',actions:[{type:'move_clip',clip_id:'clip-1',start:3}]});
 assert.equal(pendingEditorEdit(owner).edit.id,edit.id);
 assert.equal(pendingEditorEdit(other).edit,null);
 assert.throws(()=>getEditorEdit(other,edit.id),/not found/);
});
test('invalid proposals never enter the queue',()=>{
 const s=session();publishEditorSnapshot(s,project());
 assert.throws(()=>proposeEditorEdits(s,{summary:'Execute arbitrary code',actions:[{type:'eval',code:'delete all'}]}),/Cannot propose edit/);
 assert.equal(pendingEditorEdit(s).edit,null);
});
test('all AI edits require browser approval before progress can advance',()=>{
 const s=session();publishEditorSnapshot(s,project());
 const edit=proposeEditorEdits(s,{summary:'Make a portrait project',actions:[{type:'set_canvas',aspect:'9:16'}]});
 assert.equal(getEditorEdit(s,edit.id).status,'pending');
 assert.throws(()=>progressEditorEdit(s,edit.id,{status:'complete',progress:1}),/not in progress/);
 assert.equal(reviewEditorEdit(s,edit.id,'approve').status,'applying');
 assert.equal(progressEditorEdit(s,edit.id,{status:'applying',progress:1}).progress,1);
 assert.equal(progressEditorEdit(s,edit.id,{status:'complete',progress:1}).status,'complete');
 assert.throws(()=>reviewEditorEdit(s,edit.id,'approve'),/already complete/);
});
test('rejecting an AI edit leaves project untouched',()=>{
 const s=session(),p=project();publishEditorSnapshot(s,p);
 const e=proposeEditorEdits(s,{summary:'Remove a clip',actions:[{type:'remove_clip',clip_id:'clip-1'}]});
 assert.equal(reviewEditorEdit(s,e.id,'reject').status,'rejected');
 assert.equal(visibleEditorSnapshot(s).project.clips.length,1);
});
test('project changes invalidate old AI proposals before approval',()=>{
 const s=session(),p=project();publishEditorSnapshot(s,p);
 const e=proposeEditorEdits(s,{summary:'Move the first clip',actions:[{type:'move_clip',clip_id:'clip-1',start:5}]});
 publishEditorSnapshot(s,{...p,name:'Updated human name'});
 assert.equal(getEditorEdit(s,e.id).status,'stale');
 assert.equal(pendingEditorEdit(s).edit,null);
 assert.throws(()=>reviewEditorEdit(s,e.id,'approve'),/already stale/);
});
test('only sanitized project metadata may be sent to the relay',()=>{
 const s=session(),p=project();
 assert.throws(()=>publishEditorSnapshot(s,{...p,assets:[{...p.assets[0],url:'blob:secret'}]}),/Do not submit media data/);
 assert.throws(()=>publishEditorSnapshot(s,{...p,assets:[{...p.assets[0],file:'secret'}]}),/Do not submit media data/);
 assert.equal(visibleEditorSnapshot(s).project,null);
});
test('demo uses same approval and visible action queue as an AI client',()=>{
 const s=session();publishEditorSnapshot(s,project());
 const e=demoEditorEdit(s);
 assert.equal(e.actions.length,2);
 assert.equal(e.actions[0].type,'set_canvas');
 assert.equal(e.actions[1].type,'add_text');
 assert.equal(getEditorEdit(s,e.id).status,'pending');
});
