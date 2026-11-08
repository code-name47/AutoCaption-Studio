import {defineConfig} from '@playwright/test';

// Unlike the fast mocked UI tests, this suite starts the real Express MCP router
// and the compiled browser editor; only the Google identity login is test-seeded.
export default defineConfig({
 testDir:'./tests/integration',
 timeout:90_000,
 expect:{timeout:12_000},
 workers:1,
 retries:0,
 reporter:[['list'],['html',{outputFolder:'playwright-report/integration',open:'never'}]],
 outputDir:'test-results/ai-real-run',
 use:{
  baseURL:'http://127.0.0.1:4184',
  browserName:'chromium',
  headless:true,
  viewport:{width:1440,height:900},
  video:'on',
  screenshot:'on',
  trace:'off'
 },
 webServer:{
  command:'NODE_ENV=test node tests/fixtures/integrationServer.js',
  url:'http://127.0.0.1:4184/__integration/health',
  reuseExistingServer:false,
  timeout:30_000
 }
});
