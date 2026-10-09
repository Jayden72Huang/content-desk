import {loadProExtension} from './pro-extension';
import path from 'node:path';
import sharp from 'sharp';
import {AgentRunner} from './agent-runner';
import {ArtifactStore,starterTemplate} from './artifact-store';
import {parseArtifact} from './content-contract';
import {articleHtml,escapeHtml} from './render-artifact';
import {defaults} from '../article-format';
import type {LocalStore} from '../store';
export async function studioService(store:LocalStore){
 const runner=new AgentRunner(path.join(store.dir,'jobs')),artifacts=new ArtifactStore(path.join(store.dir,'artifacts'));
 if(!artifacts.list().length)artifacts.save(starterTemplate);
 const logo='data:image/png;base64,'+(await sharp(Buffer.from('<svg width="780" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="780" height="120" fill="#101113"/><rect x="30" y="34" width="40" height="52" rx="7" fill="#e8da75"/><path d="M42 47h19M42 60h15M42 73h19" stroke="#101113" stroke-width="3"/><text x="92" y="77" fill="#f1f2ed" font-family="sans-serif" font-size="37">Content Desk</text></svg>')).png().toBuffer()).toString('base64');
 if(!store.catalog().series.length)store.saveCatalog({series:[{id:'my-first-series',name:'我的第一个系列',createdAt:new Date().toISOString(),description:'从一个好想法开始，积累自己的内容与模板。',layout:'深色编辑模板',settings:defaults}]});
 for(const series of store.catalog().series){if(!store.template(series.id))store.saveTemplate({seriesId:series.id,settings:defaults,logo});}
 const generate=(value:{provider:'codex'|'claude';type:'module'|'template'|'article';prompt:string;templateId?:string})=>{
  const template=value.templateId?artifacts.get(value.templateId).artifact:undefined;
  if(template&&template.type!=='template')throw new Error('请选择内容模板');
  return runner.start({...value,template});
 };
 const pro=await loadProExtension({dataDir:store.dir,runner:{start:generate,get:id=>runner.get(id),cancel:id=>runner.cancel(id)},artifacts});
 return {shutdown:()=>{pro.shutdown();runner.shutdown();},proRoute:pro.route,async route(method:string,url:URL,input:()=>Promise<unknown>):Promise<unknown>{
  const route=url.pathname.replace('/api/studio','');
  if(method==='GET'&&route==='/state')return {artifacts:artifacts.list(),jobs:runner.list(),series:store.catalog().series};
  if(method==='GET'&&route==='/agents')return {agents:await runner.detect()};
  if(method==='POST'&&route==='/generate'){
   const value=await input() as {provider:'codex'|'claude';type:'module'|'template'|'article';prompt:string;templateId?:string};
   return generate(value);
  }
  if(method==='GET'&&route==='/job')return runner.get(url.searchParams.get('id')||'');
  if(method==='POST'&&route==='/cancel'){const value=await input() as {id:string};return runner.cancel(value.id);}
  if(method==='POST'&&route==='/save'){const value=await input() as {artifact:unknown;jobId?:string};const saved=artifacts.save(value.artifact);if(value.jobId){const job=runner.get(value.jobId);if(job.status==='ready')runner.accepted(job.id,saved.id);}return saved;}
  if(method==='POST'&&route==='/import-bundle'){const value=await input() as {bundle:unknown};return artifacts.importBundle(value.bundle);}
  if(method==='POST'&&route==='/to-editor'){
   const value=await input() as {artifact:unknown;seriesId:string};const artifact=parseArtifact(value.artifact);
   if(artifact.type!=='article')throw new Error('请选择文章');
   if(!store.catalog().series.some(s=>s.id===value.seriesId))throw new Error('系列不存在');
   const saved=artifacts.save(artifact);const prior=store.list().find(s=>s.issueId==='studio-'+saved.id.slice(0,24)&&s.seriesId===value.seriesId);if(prior)return {revision:prior.revision,url:'/editor?revision='+prior.revision};const template=store.template(value.seriesId),settings={...defaults,...template?.settings};
   const cover='data:image/png;base64,'+(await sharp(Buffer.from(`<svg width="1200" height="510" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="510" fill="#171c1a"/><rect x="55" y="70" width="7" height="350" fill="#e8da75"/><text x="90" y="155" fill="#9db6aa" font-family="sans-serif" font-size="26">CONTENT DESK / ARTICLE</text><text x="90" y="255" fill="#f3f1e4" font-family="sans-serif" font-size="38">${escapeHtml(artifact.title.slice(0,24))}</text><text x="90" y="315" fill="#f3f1e4" font-family="sans-serif" font-size="38">${escapeHtml(artifact.title.slice(24,48))}</text></svg>`)).png().toBuffer()).toString('base64');
   const snapshot=store.save({issueId:'studio-'+saved.id.slice(0,24),seriesId:value.seriesId,title:artifact.title,html:articleHtml(artifact,template?.logo||logo,cover,settings),cover,settings,digest:artifact.description.slice(0,120)});
   return {revision:snapshot.revision,url:'/editor?revision='+snapshot.revision};
  }
  throw new Error('Unknown studio route');
 }};
}
