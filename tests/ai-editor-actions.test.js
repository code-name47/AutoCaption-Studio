import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACKS,newClip} from '../src/editorCore.js';
import {editorProjectSnapshot,applyEditorAction,previewEditorActions} from '../src/aiEditCommands.js';

const media={id:'video-a',name:'sample.mp4',kind:'video',duration:20,type:'video/mp4'};
const text={id:'subtitle-a',name:'Test',kind:'text',duration:3};
const initial=()=>editorProjectSnapshot({name:'Video demo',assets:[media,text],
 clips:[newClip(media,'V1',0,'clip-1'),newClip({kind:'text',duration:3,text:'hello'},'C1',2,'caption-1')],
 settings:{aspect:'16:9',fps:30},tracks:TRACKS});
test('AI edit snapshot never contains source bytes or URLs',()=>{
 const p=editorProjectSnapshot({name:'Demo',assets:[{...media,file:new Uint8Array(4),url:'blob:secret',thumbnail:'secret'}],
 clips:[],settings:{aspect:'16:9',fps:30},tracks:TRACKS});
 assert.deepEqual(p.assets,[{id:'video-a',name:'sample.mp4',kind:'video',duration:20}]);
});
test('AI can set portrait aspect and move a clip while preserving original input',()=>{
 const p=initial(),result=previewEditorActions(p,[{type:'set_canvas',aspect:'9:16'},{type:'move_clip',clip_id:'clip-1',start:5}]);
 assert.equal(result.project.settings.aspect,'9:16');
 assert.equal(result.project.clips[0].start,5);
 assert.equal(p.settings.aspect,'16:9');
 assert.equal(p.clips[0].start,0);
 assert.equal(result.steps.length,2);
});
test('AI can insert an imported asset and add a caption with predictable ids',()=>{
 const p=initial();
 const result=previewEditorActions(p,[{type:'add_media',asset_id:'video-a',track_id:'V2',start:10},
  {type:'add_text',text:'A sample subtitle',start:10,duration:2,track_id:'C1'}]);
 assert.equal(result.project.clips.length,4);
 assert.equal(result.project.clips[2].trackId,'V2');
 assert.equal(result.project.clips[3].text,'A sample subtitle');
 assert.equal(result.project.clips[3].positionY,85);
 assert.deepEqual(previewEditorActions(p,[{type:'add_media',asset_id:'video-a',track_id:'V2',start:10},
  {type:'add_text',text:'A sample subtitle',start:10,duration:2,track_id:'C1'}]).project,result.project);
});
test('AI can split clips, trim original source and change caption words',()=>{
 const p=initial();
 const result=previewEditorActions(p,[{type:'trim_clip',clip_id:'clip-1',in_point:1,out_point:16},
  {type:'split_clip',clip_id:'clip-1',time:4},
  {type:'set_text',clip_id:'caption-1',text:'new spoken words'}]);
 assert.equal(result.project.clips.length,3);
 assert.equal(result.project.clips.find(c=>c.id==='clip-1').outPoint,5);
 assert.equal(result.project.clips.find(c=>c.id==='caption-1').text,'new spoken words');
});
test('AI can apply a validated property and transition',()=>{
 const p=initial();
 const q=previewEditorActions(p,[{type:'set_clip_property',clip_id:'caption-1',property:'fontSize',value:4},
  {type:'set_transition',clip_id:'clip-1',transition:'fade',duration:.7}]).project;
 assert.equal(q.clips.find(c=>c.id==='caption-1').fontSize,4);
 assert.equal(q.clips.find(c=>c.id==='clip-1').transitionIn,'fade');
});
test('AI cannot mutate unknown objects, properties, or leave the document partially updated',()=>{
 const p=initial(),copy=JSON.stringify(p);
 assert.throws(()=>previewEditorActions(p,[{type:'set_canvas',aspect:'9:16'},
  {type:'set_clip_property',clip_id:'clip-1',property:'__proto__',value:999}]),/Property is not editable/);
 assert.equal(JSON.stringify(p),copy);
 assert.throws(()=>applyEditorAction(p,{type:'move_clip',clip_id:'clip-1',start:4,track_id:'T1'}),/Incompatible/);
 assert.throws(()=>applyEditorAction(p,{type:'set_canvas',aspect:'evil'}),/Unsupported/);
 assert.throws(()=>applyEditorAction(p,{type:'remove_clip',clip_id:'missing'}),/not found/);
 assert.throws(()=>applyEditorAction(p,{type:'set_canvas',aspect:'16:9',javascript:'alert(1)'}),/Unexpected/);
 assert.throws(()=>applyEditorAction(p,{type:'add_text',text:'x'.repeat(3001),start:0,duration:1}),/text length/);
});
test('AI proposal has bounded number of operations and valid source in/out ranges',()=>{
 const p=initial();
 assert.throws(()=>previewEditorActions(p,[]),/1–12/);
 assert.throws(()=>previewEditorActions(p,Array.from({length:13},()=>({type:'set_canvas',aspect:'9:16'}))),/1–12/);
 assert.throws(()=>applyEditorAction(p,{type:'trim_clip',clip_id:'clip-1',in_point:5,out_point:23}),/source media duration/);
 assert.throws(()=>applyEditorAction(p,{type:'move_clip',clip_id:'clip-1',start:Infinity}),/Invalid clip start/);
});
