import {test,expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadProExtension,type ExtensionContext} from './pro-extension';
const context:ExtensionContext={dataDir:'/unused',runner:{start:()=>({id:'job',status:'running'}),get:()=>({id:'job',status:'ready'}),cancel:()=>({id:'job',status:'cancelled'})},artifacts:{list:()=>[]}};
test('Community runs without an extension and rejects paid operations',async()=>{
 const extension=await loadProExtension(context,{});
 expect(await extension.route('GET',new URL('http://localhost/api/pro/status'),async()=>null)).toEqual({available:false,active:false});
 await expect(extension.route('POST',new URL('http://localhost/api/pro/queue'),async()=>null)).rejects.toThrow('尚未安装');
 extension.shutdown();
});
test('extension loading requires a local absolute path and verification key',async()=>{
 await expect(loadProExtension(context,{CONTENT_DESK_PRO_MODULE:'https://example.com/pro.js'})).rejects.toThrow('绝对路径');
 await expect(loadProExtension(context,{CONTENT_DESK_PRO_MODULE:'/tmp/pro.js'})).rejects.toThrow('公钥');
});
test('extension receives the shared runner and artifact library',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-desk-extension-'));
 try{
  const file=path.join(dir,'extension.ts');
  fs.writeFileSync(file,'export function createProExtension(context){return {shutdown(){},async route(){return {job:context.runner.start({}),artifacts:context.artifacts.list(),key:context.publicKey};}}}');
  const extension=await loadProExtension(context,{CONTENT_DESK_PRO_MODULE:file,CONTENT_DESK_PRO_PUBLIC_KEY:'test-public-key'});
  expect(await extension.route('GET',new URL('http://localhost/api/pro/status'),async()=>null)).toEqual({job:{id:'job',status:'running'},artifacts:[],key:'test-public-key'});
  extension.shutdown();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
