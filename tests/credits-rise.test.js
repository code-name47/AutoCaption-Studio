import test from 'node:test';
import assert from 'node:assert/strict';
import {newClip,TRACKS} from '../src/editorCore.js';
import {applyEditorAction} from '../src/aiEditCommands.js';
import {risingTextPosition} from '../src/editorMotion.js';

function project(kind='text'){
 const clip=newClip({kind,duration:2,text:'Looking forward to playing!'},kind==='text'?'C1':'V1',0,'clip-1');
 clip.positionY=80;
 return {version:2,name:'Credits motion test',assets:[],clips:[clip],
  settings:{aspect:'9:16',fps:30,tracks:TRACKS}};
}

test('rise from below is a text-only AI transition and keeps the original start',()=>{
 const base=project();
 const result=applyEditorAction(base,{type:'set_transition',clip_id:'clip-1',transition:'rise',duration:.4});
 const c=result.project.clips[0];
 assert.equal(c.transitionIn,'rise');
 assert.equal(c.start,0);
 assert.equal(c.transitionDuration,.4);
 assert.equal(base.clips[0].transitionIn,'none');
 assert.throws(()=>applyEditorAction(project('video'),{type:'set_transition',clip_id:'clip-1',transition:'rise',duration:.4}),/only to text/);
});

test('credits-style caption rises from below frame and holds with a gentle upward drift',()=>{
 const c=applyEditorAction(project(),{type:'set_transition',clip_id:'clip-1',transition:'rise',duration:.4}).project.clips[0];
 const beginning=risingTextPosition(c,0);
 const halfway=risingTextPosition(c,.2);
 const landed=risingTextPosition(c,.4);
 const ending=risingTextPosition(c,1.95);
 assert.ok(beginning>=104);
 assert.ok(halfway<beginning&&halfway>landed);
 assert.ok(Math.abs(landed-80)<.001);
 assert.ok(ending<landed&&ending>=77);
 assert.equal(risingTextPosition({...c,transitionIn:'none'},.2),80);
});
