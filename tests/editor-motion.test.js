import test from 'node:test';
import assert from 'node:assert/strict';
import {newClip,clipEnd} from '../src/editorCore.js';
import {overlaps,visualClipOpacity,audioClipGain,animateAt,newMotionClip,resolvedClip,captureMotion} from '../src/editorMotion.js';

const source={id:'v',kind:'video',duration:10,name:'footage.mp4'};
const a=newClip(source,'V1',0,'a'),b=newClip(source,'V1',8,'b');
const between=(value,target,epsilon=.001)=>assert.ok(Math.abs(value-target)<epsilon,String(value)+' expected '+String(target));

test('same-track overlaps create a visible transition region',()=>{
 const regions=overlaps([a,b]);
 assert.equal(regions.length,1);
 assert.equal(regions[0].start,8);
 assert.equal(regions[0].end,10);
 assert.equal(regions[0].duration,2);
 assert.equal(regions[0].incomingId,'b');
});
test('crossfades are only auto-created for clips on the same track',()=>{
 assert.equal(overlaps([a,{...b,trackId:'V2'}]).length,0);
 assert.equal(overlaps([a,{...b,start:10}]).length,0);
});
test('video overlap overlays incoming clip at 50% opacity while outgoing stays visible',()=>{
 between(visualClipOpacity(b,[a,b],9),.5);
 between(visualClipOpacity(a,[a,b],9),1);
 between(visualClipOpacity(b,[a,b],8),0);
 between(visualClipOpacity(b,[a,b],10),1);
});
test('overlap applies equal-power gains to both source audio streams',()=>{
 between(audioClipGain(a,[a,b],9),Math.SQRT1_2);
 between(audioClipGain(b,[a,b],9),Math.SQRT1_2);
 between(audioClipGain({...b,muted:true},[a,b],9),0);
});
test('animation interpolation supports precise sizes below 12 and off-canvas positions',()=>{
 const values=animateAt([
  {t:0,values:{fontSize:4,offsetX:-120,scale:.1}},
  {t:2,values:{fontSize:8,offsetX:80,scale:.5}}
 ],1);
 between(values.fontSize,6);
 between(values.offsetX,-20);
 between(values.scale,.3);
});
test('recorded keyframes are reusable motion clips that follow timeline placement',()=>{
 const title={...newClip({id:'t',kind:'text',duration:5,text:'Hello'},'T1',0,'title'),fontSize:4};
 const animation=newMotionClip({id:'m',trackId:'T1',targetClipId:'title',start:0,end:2,keyframes:[
  {t:0,values:{...captureMotion(title),offsetX:-180}},
  {t:2,values:{...captureMotion(title),offsetX:80,fontSize:10}}
 ]});
 const resolved=resolvedClip(title,[title,animation],1);
 between(resolved.offsetX,-50);
 between(resolved.fontSize,7);
 assert.equal(animation.kind,'motion');
 const other={...title,id:'replacement',trackId:'T1',start:10};
 const relocated={...animation,start:10,targetClipId:'missing'};
 const reused=resolvedClip(other,[other,relocated],11);
 between(reused.fontSize,7);
 between(reused.offsetX,-50);
});
test('animation clip duration survives saving and reuse',()=>{
 const m=newMotionClip({id:'anim',trackId:'V1',targetClipId:'a',start:3,end:5,keyframes:[{t:0,values:{scale:1}},{t:2,values:{scale:2}}]});
 assert.equal(clipEnd(m),5);
 assert.equal(m.keyframes.length,2);
});
