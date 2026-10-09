#!/usr/bin/env bun
import fs from 'node:fs';
import {parseArtifact,artifactSchema} from './product/content-contract';
const [command,...args]=process.argv.slice(2);
const value=(name:string)=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const port=value('port')||'8787';if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw new Error('Invalid port');
const base='http://127.0.0.1:'+port;
async function request(route:string,input?:unknown){let token='';if(input!==undefined){const r=await fetch(base+'/api/bootstrap');if(!r.ok)throw new Error('Cannot connect to Content Desk');token=(await r.json()).token;}const r=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:input===undefined?{}:{'Content-Type':'application/json','Origin':base,'X-Workbench-Token':token},body:input===undefined?undefined:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
try{
 if(command==='start'){if(!fs.existsSync(import.meta.dir+'/studio.html'))throw new Error('先运行 bun run build');await import('./server');}
 else if(command==='doctor')console.log(JSON.stringify(await request('/api/studio/agents'),null,2));
 else if(command==='list')console.log(JSON.stringify(await request('/api/studio/state'),null,2));
 else if(command==='generate'){const file=value('prompt-file');if(!file)throw new Error('Use --prompt-file path (UTF-8)');console.log(JSON.stringify(await request('/api/studio/generate',{provider:value('provider')||'codex',type:value('type')||'article',prompt:fs.readFileSync(file,'utf8'),templateId:value('template')}),null,2));}
 else if(command==='job'){const id=args[0];if(!id)throw new Error('Provide a job ID');console.log(JSON.stringify(await request('/api/studio/job?id='+encodeURIComponent(id)),null,2));}
 else if(command==='cancel'){if(!args[0])throw new Error('Provide a job ID');console.log(JSON.stringify(await request('/api/studio/cancel',{id:args[0]}),null,2));}
 else if(command==='import'){if(!args[0])throw new Error('Provide an artifact JSON file');const input=JSON.parse(fs.readFileSync(args[0],'utf8'));console.log(JSON.stringify(input?.format==='content-desk-bundle'?await request('/api/studio/import-bundle',{bundle:input}):await request('/api/studio/save',{artifact:parseArtifact(input)}),null,2));}
 else if(command==='schema')console.log(JSON.stringify(artifactSchema,null,2));
 else console.log('Content Desk Community\n\nbun cli.ts start [--port 8787]\nbun cli.ts doctor\nbun cli.ts list\nbun cli.ts generate --provider codex|claude --type module|template|article --prompt-file ./brief.txt [--template ID]\nbun cli.ts job JOB_ID\nbun cli.ts cancel JOB_ID\nbun cli.ts import ./artifact-or-library.json\nbun cli.ts schema\n\nCLI 操作本机正在运行的工作台。生成完成后在创作室检查并保存；不会自动同步公众号。');
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
