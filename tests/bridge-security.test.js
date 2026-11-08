import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeAccessAllowed} from '../server/bridge.js';

const makeSession=()=>({ownerId:'google-user-A',loginId:'login-A',expires:Date.now()+60000});
const owner={userId:'google-user-A',loginId:'login-A'};

test('owner can access their own bridge jobs',()=>{
 assert.equal(bridgeAccessAllowed(makeSession(),owner),true);
});
test('different Google user cannot access owner jobs',()=>{
 assert.equal(bridgeAccessAllowed(makeSession(),{userId:'google-user-B',loginId:'login-B'}),false);
});
test('second login of same Google account cannot reuse a browser bridge session',()=>{
 assert.equal(bridgeAccessAllowed(makeSession(),{userId:'google-user-A',loginId:'login-B'}),false);
});
test('browser job endpoint rejects missing login',()=>{
 assert.equal(bridgeAccessAllowed(makeSession(),null),false);
});
test('expired session is rejected even for original owner',()=>{
 assert.equal(bridgeAccessAllowed({...makeSession(),expires:Date.now()-1},owner),false);
});
test('expired session is rejected for MCP',()=>{
 assert.equal(bridgeAccessAllowed({...makeSession(),expires:Date.now()-1},null,true),false);
});
test('MCP access still requires separate bearer-token lookup by middleware',()=>{
 // This helper checks expiry, not token validity. The route's find() middleware
 // first resolves a bearer token to a session; null represents lookup failure.
 assert.equal(bridgeAccessAllowed(null,null,true),false);
});
