import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { root } from './config';

// Isolated real Chromium canvases: no collector, login session, or saved scene is touched.
const directory = mkdtempSync(join(tmpdir(), 'zhuda-chain-performance-'));
const report = join(directory, 'report.json');
const script = await build({
  stdin: {
    resolveDir: root,
    contents: `import { ChainEffects } from './games/shared/chain-effects';
      const stage=document.querySelector('.stage');
      window.bench=new ChainEffects(stage,()=>{});
      window.bench.setRenderScale?.(1/3);
      window.bench.setTheme('monochrome');
      window.bench.update('200',[]);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
});
const service = createServer((req, res) => {
  if (req.url === '/bench.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(script.outputFiles![0]!.contents);
  } else if (req.url?.endsWith('.png')) {
    res.setHeader('content-type', 'image/png');
    res.end(readFileSync(join(root, 'client/public/generated', req.url.slice(1))));
  } else {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><style>
      body{margin:0;background:#222}.stage{position:relative;width:1080px;height:1920px;transform:scale(.333333);transform-origin:top left}
      canvas,#effects{position:absolute;inset:0;width:100%;height:100%}
      #delta{position:absolute;bottom:0;color:white}
    </style><div class="stage"><canvas class="chain-rig"></canvas><canvas class="chain-motion"></canvas><div id="effects"></div><div id="delta"></div></div><script src="bench.js"></script>`);
  }
});
await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
const address = service.address();
assert.ok(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}`;
const runner = join(directory, 'runner.cjs');
// require('electron') resolves differently inside the Electron main process.
writeFileSync(
  runner,
  `const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:390,height:844,useContentSize:true,title:'锁链性能验证',webPreferences:{backgroundThrottling:false,sandbox:true}});
 window.setIgnoreMouseEvents(true);
 try{
 await window.loadURL(${JSON.stringify(url)});
 const result=await window.webContents.executeJavaScript(${JSON.stringify(`(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async test=>{for(let i=0;i<1000;i++){if(test())return;await pause(10)}throw Error('chain timeout')};
 const rig=document.querySelector('.chain-rig'),motion=document.querySelector('.chain-motion');
 await wait(()=>rig.dataset.renderedCount==='200');
 const results=[];
 for(const theme of ['classic','monochrome','plush']){
   bench.setTheme(theme);await wait(()=>rig.dataset.renderedCount==='200');
   for(const affected of [10,100]){
     bench.update('200',[]);await wait(()=>rig.dataset.renderedCount==='200');
     const gaps=[],costs=[];let last=0,draws=0;
     const original=requestAnimationFrame,drawImage=CanvasRenderingContext2D.prototype.drawImage;
     CanvasRenderingContext2D.prototype.drawImage=function(...args){draws++;return Reflect.apply(drawImage,this,args)};
     window.requestAnimationFrame=callback=>original(now=>{const start=performance.now();if(last)gaps.push(now-last);last=now;callback(now);costs.push(performance.now()-start)});
     const started=performance.now();
     bench.update(String(200-affected),[{before:'200',after:String(200-affected),senderName:'test',giftName:'test',quantity:'1'}]);
     await wait(()=>motion.dataset.renderedCount===String(affected));
     const count=motion.dataset.renderedCount;
     await wait(()=>motion.dataset.renderedCount==='0');
     window.requestAnimationFrame=original;CanvasRenderingContext2D.prototype.drawImage=drawImage;
     const percentile=(a,p)=>a.sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]??0;
     results.push({theme,affected,count,duration:performance.now()-started,frames:costs.length,frameP95:percentile(gaps,.95),jsP95:percentile(costs,.95),jsMax:Math.max(...costs),draws,pixelWidth:rig.width,pixelHeight:rig.height,cssWidth:rig.clientWidth,dpr:devicePixelRatio});
     bench.update('200',[]);await wait(()=>rig.dataset.renderedCount==='200');await pause(100);
   }
 }
 // Queue alternating gifts during an unlock; they must not speed up that unlock.
 const started=performance.now();
 bench.update('190',[{before:'200',after:'190',senderName:'test',giftName:'test',quantity:'1'}]);
 await wait(()=>motion.dataset.renderedCount==='10');
 await pause(150);
 bench.update('190',[
   {before:'190',after:'200',senderName:'test',giftName:'test',quantity:'1'},
   {before:'200',after:'190',senderName:'test',giftName:'test',quantity:'1'},
   {before:'190',after:'200',senderName:'test',giftName:'test',quantity:'1'},
   {before:'200',after:'190',senderName:'test',giftName:'test',quantity:'1'}]);
 await wait(()=>motion.dataset.kind==='lock');
 const queuedFirstDuration=performance.now()-started;
 bench.dispose();
 return {results,queuedFirstDuration};
})()`)});
 fs.writeFileSync(${JSON.stringify(report)},JSON.stringify(result,null,2));
 window.destroy();app.exit(0);
 }catch(error){console.error(error);app.exit(1)}
});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
const child = spawn(require('electron') as string, ['--force-device-scale-factor=3', runner], {
  cwd: root,
  env,
  stdio: 'inherit',
});
const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000);
try {
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  assert.equal(code, 0);
  const result = JSON.parse(readFileSync(report, 'utf8'));
  for (const sample of result.results) {
    assert.equal(Number(sample.count), sample.affected, '每根变化都必须参与动画');
    assert.equal(sample.pixelWidth, 1080, '三倍密度手机缩小到 1/3 时必须匹配屏幕像素');
    assert.equal(sample.pixelHeight, 1920);
    assert.ok(sample.duration >= 2350, '默认消融必须完整播放 2.4 秒');
  }
  assert.ok(result.queuedFirstDuration >= 2350, '排队礼物不得加速进行中的消融');
  const output = process.argv[2];
  if (output) {
    mkdirSync(join(root, '.local/chain-performance'), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(timeout);
  service.close();
  rmSync(directory, { recursive: true, force: true });
}
