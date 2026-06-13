// Dev-only: derive dist/preview.html from the built dist/index.html by stripping
// the CSP meta and injecting a stubbed window.photoshoot bridge, so the renderer
// chrome can be inspected in a plain browser (no Electron/camera). Not shipped.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let html = readFileSync(path.join(dist, 'index.html'), 'utf8');

// Remove the CSP meta (harness uses an inline script + http).
html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '');

const th = (c) => "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='88' height='88'%3E%3Crect width='88' height='88' fill='%23" + c + "'/%3E%3Ccircle cx='44' cy='34' r='15' fill='%23ffffff44'/%3E%3C/svg%3E";
const big = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='480'%3E%3Crect width='640' height='480' fill='%23222'/%3E%3Ccircle cx='320' cy='200' r='90' fill='%23ffffff33'/%3E%3C/svg%3E";
const gallery = [
  { id: 'a', filename: 'Photoshoot_single_a.png', path: '', kind: 'single', effect: 'normal', format: 'png', createdAt: 2, thumbnail: th('3a3a44'), width: 88, height: 88 },
  { id: 'b', filename: 'Photoshoot_single_b.png', path: '', kind: 'single', effect: 'sepia', format: 'png', createdAt: 1, thumbnail: th('44384a'), width: 88, height: 88 },
];
const mock = `<script>(function(){let s={theme:'modern',cameraId:null,mirror:true,countdownSeconds:3,format:'png',volume:0.7,muted:false,bgTolerance:0.28,perfOverlay:false,reducedMotion:false};const gallery=${JSON.stringify(gallery)};window.photoshoot={getAppInfo:async()=>({name:'Photoshoot',version:'1.0.0',saveFolder:'C\\\\:\\\\Users\\\\You\\\\Pictures\\\\Photoshoot',themesFolder:'',platform:'win32'}),getSettings:async()=>s,setSettings:async(p)=>(s={...s,...p}),saveCapture:async()=>({ok:false}),listGallery:async()=>gallery,readItem:async()=>({ok:true,dataUrl:${JSON.stringify(big)},mime:'image/svg+xml'}),exportItem:async()=>({ok:false,canceled:true}),deleteGalleryItem:async()=>({ok:true}),revealItem:async()=>({ok:true}),openItem:async()=>({ok:true}),openSaveFolder:async()=>({ok:true}),importTheme:async()=>({ok:false,canceled:true}),listImportedThemes:async()=>[],removeImportedTheme:async()=>({ok:true}),minimizeWindow:()=>{},toggleMaximizeWindow:()=>{},closeWindow:()=>{}};})();</script>`;

html = html.replace('<script src="renderer.js"></script>', mock + '\n    <script src="renderer.js"></script>');
writeFileSync(path.join(dist, 'preview.html'), html);
console.log('Wrote dist/preview.html');
