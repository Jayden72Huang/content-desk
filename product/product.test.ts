import {test,expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ArtifactStore,starterTemplate} from './artifact-store';
import {agentArgs,agentEnvironment,AgentRunner,atomic} from './agent-runner';
import {renderModules} from './render-artifact';
import type {ContentArtifact} from './content-contract';
test('artifact versions persist independently and save is idempotent',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-desk-store-'));try{const store=new ArtifactStore(dir),first=store.save(starterTemplate);expect(store.save(starterTemplate).id).toBe(first.id);const second=store.save({...starterTemplate,title:'另一个版本'});expect(second.id).not.toBe(first.id);expect(new ArtifactStore(dir).get(first.id).artifact.title).toBe('观点拆解');expect(()=>store.get('../secret')).toThrow();}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('interrupted jobs are made explicit after restart',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-desk-jobs-'));try{const id=crypto.randomUUID();fs.mkdirSync(path.join(dir,id));atomic(path.join(dir,id,'job.json'),{id,status:'running',createdAt:new Date().toISOString()});const runner=new AgentRunner(dir);expect(runner.get(id).status).toBe('failed');expect(runner.get(id).error).toContain('中断');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('CLI adapters do not bypass permission gates or inherit publisher secrets',()=>{expect(agentArgs('codex','/tmp/task')).toContain('read-only');expect(agentArgs('claude','/tmp/task')).toContain('--strict-mcp-config');expect(agentArgs('codex','/tmp/task').join(' ')).not.toContain('bypass');expect(agentEnvironment()).not.toHaveProperty('WECHAT_MP_SECRET');expect(agentEnvironment()).not.toHaveProperty('WECHAT_CONFIG_PATH');});
test('module renderer escapes HTML and refuses unresolved assets',()=>{const article:ContentArtifact={schemaVersion:1,type:'article',title:'test',description:'',audience:'',voice:'',slots:[],modules:[{id:'a',kind:'paragraph',text:'<img src=x onerror=alert(1)>',items:[],assetId:'',alt:''},{id:'b',kind:'sources',text:'公开资料：用户提供',items:[],assetId:'',alt:''}]};const html=renderModules(article);expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).toContain('data-sources="1"');expect(()=>renderModules({...article,modules:[{id:'c',kind:'image',text:'',items:[],assetId:'unavailable',alt:'test'}]})).toThrow();});

test('article handoff is idempotent and preserves subsequent manual editing',async()=>{
 const {LocalStore}=await import('../store');const {studioService}=await import('./studio-api');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-desk-handoff-'));
 const store=new LocalStore(dir),studio=await studioService(store);
 try{
  const artifact:ContentArtifact={schemaVersion:1,type:'article',title:'测试交付',description:'人工检查后发布',audience:'创作者',voice:'简洁',slots:[],modules:[{id:'p',kind:'paragraph',text:'这里是一段有效的正文。',items:[],assetId:'',alt:''}]};
  const route=new URL('http://127.0.0.1/api/studio/to-editor');const input=async()=>({artifact,seriesId:'my-first-series'});
  const first=await studio.route('POST',route,input) as {revision:string};
  await new Promise(resolve=>setTimeout(resolve,5));
  const edited=store.save({...store.get(first.revision),title:'人工修改后的标题'});
  const second=await studio.route('POST',route,input) as {revision:string};
  expect(second.revision).toBe(edited.revision);expect(store.list()).toHaveLength(2);
 }finally{studio.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
