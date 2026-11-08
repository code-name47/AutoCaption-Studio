import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACKS,trackFor,accepts,newClip,clipLength,clipEnd,splitClip,trimClip,placeClip,activeClips,addTransition,renderOpacity,serializeProject,isValidProject,timelineDuration,snapTime} from '../src/editorCore.js';
const media={id:'asset-a',name:'Video.mp4',kind:'video',duration:10,type:'video/mp4'};
const audio={id:'asset-b',name:'Song.mp3',kind:'audio',duration:16,type:'audio/mpeg'};
const one=newClip(media,'V1',0,'clip-one'),two=newClip(media,'V1',10,'clip-two');
test('native project exposes multiple video, audio, title and caption tracks',()=>{
 assert.ok(TRACKS.filter(x=>x.kind==='video').length>=2);
 assert.ok(TRACKS.some(x=>x.id==='C1'));
 assert.equal(trackFor('V4').kind,'video');
 assert.equal(trackFor('A3').kind,'audio');
});
test('compatible media can move between matching tracks',()=>{
 assert.equal(accepts(media,'V2'),true);
 assert.equal(accepts(media,'A2'),true);
 assert.equal(accepts(audio,'V1'),false);
 assert.equal(accepts(audio,'A3'),true);
});
test('timeline shows multiple layers when clips overlap',()=>{
 const layers=activeClips([one,{...two,id:'overlay',trackId:'V2',start:3}],4);
 assert.equal(layers.length,2);
 assert.equal(layers[1].id,'overlay');
});
test('timeline supports trims without changing underlying source media',()=>{
 const trimmed=trimClip(one,'start',2,10);
 assert.equal(trimmed.start,2);
 assert.equal(trimmed.inPoint,2);
 assert.equal(clipLength(trimmed),8);
 const shortened=trimClip(trimmed,'end',-3,10);
 assert.equal(shortened.outPoint,7);
 assert.equal(clipLength(shortened),5);
 assert.equal(one.inPoint,0);
});
test('split at playhead keeps both source ranges and overall duration',()=>{
 const sections=splitClip(one,4,'clip-right');
 assert.equal(sections.length,2);
 assert.equal(sections[0].outPoint,4);
 assert.equal(sections[1].inPoint,4);
 assert.equal(sections[1].start,4);
 assert.equal(clipEnd(sections[1]),clipEnd(one));
});
test('magnetic snapping aligns dropped clip to nearby edges',()=>{
 assert.equal(snapTime(10.07,[one],'clip-other',.12),10);
 const moved=placeClip([one,two],'clip-two','V2',13.5);
 assert.equal(moved[1].trackId,'V2');
 assert.equal(moved[1].start,13.5);
});
test('cross dissolve overlaps adjoining clips and fades incoming layer',()=>{
 const transitioned=addTransition([one,two],'clip-two','crossfade',.8);
 const incoming=transitioned[1];
 assert.ok(incoming.start<10);
 assert.ok(incoming.start>9);
 assert.equal(incoming.transitionIn,'crossfade');
 const midway=incoming.start+.4;
 assert.equal(activeClips(transitioned,midway).length,2);
 assert.ok(renderOpacity(incoming,midway)>.3&&renderOpacity(incoming,midway)<.7);
});
test('timeline duration covers all tracks and text layers',()=>{
 assert.equal(timelineDuration([one,two]),20);
 assert.equal(clipLength(newClip({kind:'text',duration:3,text:'Hello'},'T1',5,'txt')),3);
});
test('project serialization retains edits but excludes video buffers and URLs',()=>{
 const project=serializeProject('Test',[{...media,file:new Uint8Array([1,2,3]),url:'blob:example'}],[one],{aspect:'16:9'});
 assert.equal(isValidProject(project),true);
 assert.equal(project.assets[0].url,undefined);
 assert.equal(project.assets[0].file,undefined);
 assert.equal(project.clips[0].start,0);
});
