import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACKS,newClip,clipEnd} from '../src/editorCore.js';
import {detachAudioFromVideo,splitStereoAudio,rippleDelete,applyAudioPreset,clipAudioConfig,
 chromaOpacity,syncLinkedAudio,splitLinkedVideoAudio,removeLinkedWithVideo} from '../src/editorEnhancements.js';
import {applyChromaToPixels} from '../src/editorChroma.js';
import {audioTrackEnabled} from '../src/editorAudio.js';
import {applyEditorAction} from '../src/aiEditCommands.js';

const video=(id='v1',start=0,duration=5)=>newClip({id:'source',kind:'video',duration},'V1',start,id);
const project=clips=>({version:2,name:'Test',assets:[{id:'source',name:'video',kind:'video',duration:12}],
 clips,settings:{aspect:'16:9',fps:30,tracks:TRACKS}});

test('detached audio is a real audio clip, retains source trim and mutes video',()=>{
 const v=video();v.inPoint=1;v.outPoint=4;v.speed=1.2;v.start=2;
 const {clips,audioId}=detachAudioFromVideo([v],'v1','sound-1');
 assert.equal(audioId,'sound-1');assert.equal(clips[0].muted,true);
 assert.deepEqual([clips[1].start,clips[1].inPoint,clips[1].outPoint,clips[1].speed],[2,1,4,1.2]);
 assert.equal(clips[1].kind,'audio');assert.equal(clips[1].linkedSourceId,'v1');
 assert.equal(clips[1].muted,false);
});

test('stereo splitting creates isolated L/R tracks with independent pans',()=>{
 const v=video();const {clips}=detachAudioFromVideo([v],'v1','detached');
 const result=splitStereoAudio(clips,'detached','left','right','A1','A2');
 const a=result.clips.find(c=>c.id==='left'),b=result.clips.find(c=>c.id==='right');
 assert.equal(a.audioChannel,'left');assert.equal(b.audioChannel,'right');
 assert.equal(a.pan,-1);assert.equal(b.pan,1);
 assert.equal(a.trackId,'A1');assert.equal(b.trackId,'A2');
 assert.equal(a.start,b.start);assert.equal(a.outPoint,b.outPoint);
 assert.throws(()=>splitStereoAudio([v],'v1','x','y'),/Detach/);
});

test('linked audio follows source video trim and split and can be deleted together',()=>{
 let {clips}=detachAudioFromVideo([video()],'v1','detached');
 clips=clips.map(c=>c.id==='v1'?{...c,start:1,inPoint:1,outPoint:3}:c);
 clips=syncLinkedAudio(clips,'v1');
 assert.equal(clips[1].start,1);
 assert.equal(clips[1].inPoint,1);assert.equal(clips[1].outPoint,3);
 const left={...clips[0],outPoint:2},right={...clips[0],id:'v2',start:2,inPoint:2};
 clips=splitLinkedVideoAudio([left,right,...clips.slice(1)],'v1',[left,right],'a2');
 assert.equal(clips.find(c=>c.id==='a2').linkedSourceId,'v2');
 assert.equal(clips.find(c=>c.id==='detached').outPoint,2);
 assert.equal(removeLinkedWithVideo(clips,'v1').some(c=>c.id==='detached'),false);
});

test('ripple delete closes following gap without destroying earlier overlapping clips',()=>{
 const a=video('first',0,2),b=video('second',3,2),c=video('third',7,2);
 const filtered=rippleDelete([a,b,c],'second');
 assert.equal(filtered.find(c=>c.id==='third').start,5);
 assert.equal(filtered.find(c=>c.id==='first').start,0);
 assert.equal(filtered.some(c=>c.id==='second'),false);
 assert.throws(()=>rippleDelete([a,{...b,start:1}],'first'),/Overlapping/);
});

test('audio mixer defaults and presets are bounded, solo respects mute',()=>{
 const c=video(),d=applyAudioPreset(c,'dialogue');
 assert.equal(d.eqLow,-3);assert.equal(d.eqMid,2);
 assert.equal(clipAudioConfig({...d,pan:99}).pan,1);
 assert.equal(audioTrackEnabled('A1',{},{}),true);
 assert.equal(audioTrackEnabled('A1',{}, {A2:true}),false);
 assert.equal(audioTrackEnabled('A2',{A2:true},{A2:true}),false);
});

test('chroma key preserves opaque non-key colors and keys green out',()=>{
 const pixels={data:new Uint8ClampedArray([0,255,0,255,255,0,0,255,10,230,10,255])};
 applyChromaToPixels(pixels,{chromaKey:true,chromaColor:'#00ff00',chromaTolerance:.16,chromaSoftness:.12});
 assert.equal(pixels.data[3],0);assert.equal(pixels.data[7],255);
 assert.ok(pixels.data[11]<255);
 assert.equal(chromaOpacity(255,0,0,0,255,0),1);
});

test('AI actions safely expose matching manual edit features',()=>{
 const detached=applyEditorAction(project([video()]),{type:'detach_audio',clip_id:'v1'});
 assert.ok(detached.project.clips.some(c=>c.kind==='audio'));
 const props=applyEditorAction(project([video()]),{type:'set_clip_property',clip_id:'v1',property:'chromaKey',value:true});
 assert.equal(props.project.clips[0].chromaKey,true);
 const mix=applyEditorAction(project([video()]),{type:'audio_preset',clip_id:'v1',preset:'dialogue'});
 assert.equal(mix.project.clips[0].eqMid,2);
 const removed=applyEditorAction(project([video('a',0,2),video('b',2,2)]),{type:'ripple_delete',clip_id:'a'});
 assert.equal(removed.project.clips[0].start,0);
 assert.throws(()=>applyEditorAction(project([video()]),{type:'set_clip_property',clip_id:'v1',property:'chromaTolerance',value:100}),/Invalid/);
});
