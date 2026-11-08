import test from 'node:test';import assert from 'node:assert/strict';import {getActiveClip,totalDuration} from '../src/timeline.js';
const assets=[{id:'a',duration:4},{id:'b',duration:6}];const track=[{id:'one',assetId:'a'},{id:'two',assetId:'b'}];
test('timeline sums clip durations',()=>assert.equal(totalDuration(track,assets),10));
test('scrubbing maps to first video local time',()=>assert.equal(getActiveClip(track,assets,2).localTime,2));
test('scrubbing across cut selects next clip',()=>{const c=getActiveClip(track,assets,5);assert.equal(c.assetId,'b');assert.equal(c.localTime,1)});
test('playhead at cut selects second video',()=>assert.equal(getActiveClip(track,assets,4).assetId,'b'));
test('empty timeline has no preview',()=>assert.equal(getActiveClip([],assets,0),null));
test('reordering clips changes preview mapping',()=>assert.equal(getActiveClip([...track].reverse(),assets,2).assetId,'b'));
