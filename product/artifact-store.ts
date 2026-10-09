import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArtifact,type ContentArtifact} from './content-contract';
import {atomic} from './agent-runner';
export interface SavedArtifact{ id:string;createdAt:string;artifact:ContentArtifact; }
export interface ArtifactBundle{format:'content-desk-bundle';version:1;exportedAt:string;artifacts:SavedArtifact[];}
const artifactId=(artifact:ContentArtifact)=>createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
const validDate=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function parseBundle(input:unknown):ArtifactBundle{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('素材库备份格式无效');
 const bundle=input as ArtifactBundle;
 if(bundle.format!=='content-desk-bundle'||bundle.version!==1||!validDate(bundle.exportedAt)||!Array.isArray(bundle.artifacts))throw new Error('素材库备份格式或版本无效');
 const artifacts=bundle.artifacts.map(row=>{
  if(!row||typeof row!=='object'||!validDate(row.createdAt))throw new Error('素材版本信息无效');
  const artifact=parseArtifact(row.artifact);
  if(row.id!==artifactId(artifact))throw new Error('素材校验失败，备份内容可能被修改');
  return {id:row.id,createdAt:row.createdAt,artifact};
 });
 return {format:bundle.format,version:1,exportedAt:bundle.exportedAt,artifacts};
}
export class ArtifactStore{
 constructor(private dir:string){fs.mkdirSync(dir,{recursive:true,mode:0o700});}
 private file(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid artifact ID');return path.join(this.dir,id+'.json');}
 save(input:unknown){const artifact=parseArtifact(input),id=artifactId(artifact),file=this.file(id);if(fs.existsSync(file))return this.get(id);const result={id,createdAt:new Date().toISOString(),artifact};atomic(file,result);return result;}
 importBundle(input:unknown){
  // Validate every record before writing any file. Existing versions are immutable.
  const bundle=parseBundle(input);let imported=0,existing=0;
  for(const row of bundle.artifacts){const file=this.file(row.id);if(fs.existsSync(file)){existing++;continue;}atomic(file,row);imported++;}
  return {imported,existing};
 }
 get(id:string):SavedArtifact{return JSON.parse(fs.readFileSync(this.file(id),'utf8'));}
 list():SavedArtifact[]{return fs.readdirSync(this.dir).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>this.get(f.slice(0,-5))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
}
export const starterTemplate:ContentArtifact={schemaVersion:1,type:'template',title:'观点拆解',description:'从具体问题出发，区分事实与判断，给读者一个可用的结论。',audience:'希望理解变化并采取行动的读者',voice:'清晰、有依据、少用术语',modules:[],slots:[{id:'opening',kind:'paragraph',label:'为什么值得关注',instruction:'用一个具体问题解释读者为什么要关心。',required:true},{id:'facts',kind:'list',label:'已知事实',instruction:'最多五条可核对事实，未知项如实说明。',required:true},{id:'analysis',kind:'paragraph',label:'我的判断',instruction:'解释推理过程，区分事实和观点。',required:true},{id:'action',kind:'paragraph',label:'下一步',instruction:'给出具体建议或值得继续观察的问题。',required:true},{id:'sources',kind:'sources',label:'事实依据',instruction:'列出用户提供的资料名称、日期和链接，不编造出处。',required:true}]};
