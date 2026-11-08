import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',
 timeout:45_000,
 expect:{timeout:12_000},
 retries:process.env.CI?1:0,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',headless:true,viewport:{width:1440,height:900},trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npm run preview -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:60_000}
});
