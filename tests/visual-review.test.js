import test from 'node:test';
import assert from 'node:assert/strict';
import {publishEditorSnapshot} from '../server/editorBridge.js';
import {storeVisualReview,readVisualReview,clearVisualReview,visualReviewMcpContent} from '../server/editorVisualReview.js';
import {reviewSampleTimes,reviewTimelineNotes} from '../src/editorVisualReview.js';
import {newClip,TRACKS} from '../src/editorCore.js';

const makeProject=()=>{
 const videoA=newClip({id:'a',kind:'video',duration:3},'V1',0,'v1');
 const videoB=newClip({id:'b',kind:'video',duration:3},'V1',2.6,'v2');
 const captionA=newClip({kind:'text',duration:2,text:'First'},'C1',0,'c1');
 const captionB=newClip({kind:'text',duration:1,text:'Second'},'C1',3,'c2');
 return {version:2,name:'Private preview QA',assets:[
  {id:'a',name:'One.mp4',kind:'video',duration:3},
  {id:'b',name:'Two.mp4',kind:'video',duration:3}
 ],clips:[videoA,videoB,captionA,captionB],settings:{aspect:'9:16',fps:30,tracks:TRACKS}};
};
const session=()=>({ownerId:'test-user',loginId:'test-login',expires:Date.now()+600000,jobs:new Map()});
const fakeJpeg=()=>{const b=Buffer.alloc(200,0);b[0]=0xff;b[1]=0xd8;b[2]=0xff;b[b.length-2]=0xff;b[b.length-1]=0xd9;return b.toString('base64')};
const sample=(revision)=>({revision,frames:[{time:1,width:360,height:640,mimeType:'image/jpeg',data:fakeJpeg(),caption:'First'}],notes:['Caption gap of 1s'],waveform:[.1,.3,.2]});

test('privacy: preview never exists before explicit browser share',()=>{
 const alice=session();
 const revision=publishEditorSnapshot(alice,makeProject()).revision;
 assert.equal(readVisualReview(alice),null);
 assert.deepEqual(visualReviewMcpContent(alice),[]);
 assert.equal(storeVisualReview(alice,sample(revision)).shared,true);
 const shared=readVisualReview(alice);
 assert.equal(shared.frames.length,1);
 const content=visualReviewMcpContent(alice);
 assert.equal(content.filter(item=>item.type==='image').length,1);
 assert.equal(content[2].data,shared.frames[0].data);
 clearVisualReview(alice);
});

test('privacy: same guessed metadata cannot expose visual proofs across different sessions',()=>{
 const alice=session(),bob=session();
 const project=makeProject();
 const revision=publishEditorSnapshot(alice,project).revision;
 publishEditorSnapshot(bob,project);
 storeVisualReview(alice,sample(revision));
 assert.equal(readVisualReview(bob),null);
 assert.equal(visualReviewMcpContent(bob).length,0);
 assert.equal(clearVisualReview(bob),false);
 assert.equal(readVisualReview(alice).frames.length,1);
 clearVisualReview(alice);
});

test('privacy: any project edit invalidates previously shared images immediately',()=>{
 const alice=session();
 const project=makeProject();
 const revision=publishEditorSnapshot(alice,project).revision;
 storeVisualReview(alice,sample(revision));
 publishEditorSnapshot(alice,{...project,name:'Edited after preview'});
 assert.equal(readVisualReview(alice),null);
 assert.equal(visualReviewMcpContent(alice).length,0);
});

test('privacy: malformed frames, stale revisions, and unlimited data are rejected',()=>{
 const alice=session(),revision=publishEditorSnapshot(alice,makeProject()).revision;
 assert.throws(()=>storeVisualReview(alice,sample('wrong')),/changed/);
 assert.throws(()=>storeVisualReview(alice,{...sample(revision),frames:[]} ),/between 1 and 6/);
 assert.throws(()=>storeVisualReview(alice,{...sample(revision),frames:Array(7).fill(sample(revision).frames[0])}),/between 1 and 6/);
 assert.throws(()=>storeVisualReview(alice,{...sample(revision),frames:[{...sample(revision).frames[0],data:Buffer.alloc(150).toString('base64')}] }),/Invalid or oversized JPEG/);
 assert.throws(()=>storeVisualReview(alice,{...sample(revision),waveform:[1.1]}),/Invalid private audio/);
});

test('preview sampler selects diverse sorted timestamps and reports 0.4s cut overlap',()=>{
 const clips=makeProject().clips;
 const times=reviewSampleTimes(clips);
 assert.equal(times.length,6);
 assert.ok(times.every((t,i)=>i===0||t>times[i-1]));
 const notes=reviewTimelineNotes(clips);
 assert.ok(notes.some(x=>x.includes('Video clips overlap by 0.4s')));
 assert.ok(notes.some(x=>x.includes('Caption gap of 1s')));
 assert.ok(notes.some(x=>x.includes('Last caption ends')));
});
