import {test,expect} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ArtifactStore,starterTemplate} from './artifact-store';
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-desk-bundle-'));return {source:new ArtifactStore(path.join(dir,'source')),target:new ArtifactStore(path.join(dir,'target')),close:()=>fs.rmSync(dir,{recursive:true,force:true})};}
test('library backup round trip preserves immutable versions, dates and template structure',()=>{
 const {source,target,close}=fixture();try{
  const original=source.save(starterTemplate);source.save({...starterTemplate,title:'产品周报'});
  const bundle={format:'content-desk-bundle',version:1,exportedAt:new Date().toISOString(),artifacts:source.list()};
  expect(target.importBundle(bundle)).toEqual({imported:2,existing:0});
  expect(target.get(original.id)).toEqual(original);
  expect(target.importBundle(bundle)).toEqual({imported:0,existing:2});
  expect(target.list()).toHaveLength(2);
 }finally{close();}
});
test('a corrupt item prevents any partial import and cannot inject a filesystem path',()=>{
 const {source,target,close}=fixture();try{
  const first=source.save(starterTemplate),second=source.save({...starterTemplate,title:'Second'});
  const bundle={format:'content-desk-bundle',version:1,exportedAt:new Date().toISOString(),artifacts:[first,{...second,id:'../../outside'}]};
  expect(()=>target.importBundle(bundle)).toThrow('校验失败');expect(target.list()).toHaveLength(0);
  expect(()=>target.importBundle({...bundle,version:2})).toThrow('版本无效');
  expect(()=>target.importBundle({...bundle,artifacts:[{...first,artifact:{...first.artifact,title:'tampered'}}]})).toThrow('校验失败');
  expect(target.list()).toHaveLength(0);
 }finally{close();}
});
test('importing a duplicate preserves the original local creation time',()=>{
 const {source,target,close}=fixture();try{
  const existing=target.save(starterTemplate),remote=source.save(starterTemplate);
  target.importBundle({format:'content-desk-bundle',version:1,exportedAt:new Date().toISOString(),artifacts:[{...remote,createdAt:'2020-01-01T00:00:00.000Z'}]});
  expect(target.get(existing.id)).toEqual(existing);
 }finally{close();}
});
