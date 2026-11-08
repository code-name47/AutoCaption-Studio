// Isolated integration fixture: serves the REAL compiled editor, OAuth code,
// and editing MCP router. Only the Google login handshake is test-seeded.
// This file is not imported into the production server.
import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import bridgeRouter from '../../server/bridge.js';
import mcpOAuthRouter from '../../server/mcp-oauth.js';
import googleAuthRouter,{createBrowserLoginForIntegrationTest} from '../../server/google-auth.js';

if(process.env.NODE_ENV!=='test')throw Error('Integration fixture may only run with NODE_ENV=test');
const app=express();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
app.disable('x-powered-by');
app.get('/__integration/health',(req,res)=>res.json({ready:true,mode:'isolated-editor-mcp-test'}));
app.get('/__integration/login',(req,res)=>{
 const remote=req.socket.remoteAddress||'';
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))
  return res.status(403).send('Local browser testing only');
 const seeded=createBrowserLoginForIntegrationTest();
 res.cookie(seeded.cookieName,seeded.cookieValue,{httpOnly:true,sameSite:'lax',path:'/'});
 return res.redirect('/');
});
app.use(mcpOAuthRouter);
app.use('/api/bridge',express.json({limit:'1mb'}),bridgeRouter);
app.use('/auth/google',googleAuthRouter);
app.use(express.static(path.join(root,'dist')));
app.get('*',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));
app.listen(4184,'127.0.0.1',()=>console.log('Isolated real AI editor integration server on 127.0.0.1:4184'));
