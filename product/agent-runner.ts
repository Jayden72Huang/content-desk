import fs from 'node:fs';
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {artifactSchema,parseArtifact,type ContentArtifact} from './content-contract';
export type Provider='codex'|'claude';
export interface Job {id:string;provider:Provider;type:ContentArtifact['type'];prompt:string;status:'running'|'ready'|'failed'|'cancelled'|'accepted';createdAt:string;updatedAt:string;result?:ContentArtifact;error?:string;acceptedId?:string;}
export function atomic(file:string,value:unknown){const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}
export function executable(provider:Provider){return Bun.which(provider)||undefined;}
export function agentArgs(provider:Provider,dir:string){
 if(provider==='codex')return ['exec','--skip-git-repo-check','--ephemeral','--ignore-user-config','--sandbox','read-only','--json','--output-schema',path.join(dir,'schema.json'),'-o',path.join(dir,'result.json'),'-'];
 return ['-p','--output-format','json','--json-schema',JSON.stringify(artifactSchema),'--tools','','--permission-mode','plan','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--settings','{"disableAllHooks":true}'];
}
export function agentEnvironment(){const allowed=['PATH','HOME','USER','TMPDIR','TEMP','SystemRoot','CODEX_HOME','ANTHROPIC_API_KEY','OPENAI_API_KEY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];return Object.fromEntries(allowed.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]).concat([['LANG','en_US.UTF-8']]));}
export class AgentRunner {
 private running=new Map<string,{child:ChildProcess;timer:ReturnType<typeof setTimeout>}>();
 constructor(private dir:string,private timeoutMs=180000){fs.mkdirSync(dir,{recursive:true,mode:0o700});for(const job of this.list()){if(job.status==='running'){job.status='failed';job.error='应用重启，生成已中断。可以重新发起任务。';this.save(job);}}}
 private file(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid job ID');return path.join(this.dir,id,'job.json');}
 private save(job:Job){job.updatedAt=new Date().toISOString();atomic(this.file(job.id),job);}
 get(id:string):Job{return JSON.parse(fs.readFileSync(this.file(id),'utf8'));}
 list():Job[]{return fs.readdirSync(this.dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^[a-f0-9-]{36}$/.test(e.name)&&fs.existsSync(path.join(this.dir,e.name,'job.json'))).map(e=>this.get(e.name)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async detect(){return Promise.all((['codex','claude'] as Provider[]).map(async provider=>{const bin=executable(provider);if(!bin)return {provider,installed:false,version:''};const child=Bun.spawn([bin,'--version'],{stdout:'pipe',stderr:'pipe',env:agentEnvironment()});const timeout=setTimeout(()=>child.kill(),5000);try{const [code,version]=await Promise.all([child.exited,new Response(child.stdout).text()]);return {provider,installed:code===0,version:version.trim().slice(0,160)};}finally{clearTimeout(timeout);}}));}
 start(input:{provider:Provider;type:ContentArtifact['type'];prompt:string;template?:ContentArtifact}):Job{
 if(this.running.size)throw new Error('已有生成任务正在运行，请完成或取消后再试');
 if(!['codex','claude'].includes(input.provider)||!['module','template','article'].includes(input.type))throw new Error('无效的生成类型或 Agent');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>24000)throw new Error('请填写 1–24000 字的生成要求');
 const bin=executable(input.provider);if(!bin)throw new Error('请先安装 '+input.provider+' CLI 并在终端登录');
 const id=randomUUID(),dir=path.join(this.dir,id);fs.mkdirSync(dir,{mode:0o700});
 const job:Job={id,provider:input.provider,type:input.type,prompt:input.prompt,status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 atomic(path.join(dir,'schema.json'),artifactSchema);this.save(job);
 const prompt=`你是 Content Desk 内容设计助手。只返回符合 schema 的 JSON。输出类型必须是 ${input.type}。module 类型恰好一个 modules 元素，slots 为空；template 类型 modules 为空，slots 至少一个；article 类型 modules 至少一个，slots 为空。所有字段必须存在；无值用空字符串或空数组。内容是纯文本，不输出 HTML、JS、代码围栏。不调用工具，不访问本机文件，不联网。不编造已发生的事实或来源；资料不足时说明限制。没有提供图片素材时不要生成 image 模块。标题不超过64字。模板只设计结构与写作要求，不写正式文章。\n${input.template?'内容模板：'+JSON.stringify(input.template)+'\n':''}用户要求：\n${input.prompt}`;
 const child=spawn(bin,agentArgs(input.provider,dir),{cwd:dir,env:agentEnvironment(),stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
 let stdout='',stderr='',size=0,done=false;
 const finish=(error?:string)=>{if(done)return;done=true;const handle=this.running.get(id);if(handle)clearTimeout(handle.timer);this.running.delete(id);const latest=this.get(id);if(latest.status==='cancelled')return;
  try{if(error)throw new Error(error);let raw:unknown;if(input.provider==='codex')raw=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));else{const response=JSON.parse(stdout);if(response.is_error)throw new Error('CLI 返回失败，请确认登录与额度');raw=response.structured_output??JSON.parse(response.result||'{}');}latest.result=parseArtifact(raw);if(latest.result.type!==input.type)throw new Error('输出类型与任务不一致');latest.status='ready';}catch(e){latest.status='failed';latest.error=(e instanceof Error?e.message:'输出格式无效').slice(0,500);}this.save(latest);
 };
 const timer=setTimeout(()=>{this.kill(child);finish('生成超时，任务已停止');},this.timeoutMs);this.running.set(id,{child,timer});
 child.stdout?.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4*1024*1024){this.kill(child);finish('Agent 输出过大，任务已停止');}else stdout+=chunk.toString();});
 child.stderr?.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-4000);});
 child.on('error',()=>finish('无法启动 CLI，请检查安装路径与权限'));
 child.on('close',code=>{if(code!==0&&input.provider==='claude'){try{const output=JSON.parse(stdout);if(output.is_error&&typeof output.result==='string'){if(/account is on hold|restricted/i.test(output.result)){finish('Claude 账号当前不可用。请在 Claude 官方账号页面处理，或切换 Codex。');return;}if(/not logged in|authentication|login/i.test(output.result)){finish('Claude CLI 尚未登录，请在终端完成登录后重新生成');return;}}}catch{}}finish(code===0?undefined:`CLI 退出码 ${code}。请在终端检查登录、模型额度和 CLI 版本。${/auth|login|401/i.test(stderr)?'检测到身份验证提示。':''}`);});
 child.stdin?.on('error',()=>{});child.stdin?.end(prompt);return job;
 }
 private kill(child:ChildProcess){try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}setTimeout(()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},1500).unref();}
 cancel(id:string){const job=this.get(id);if(job.status!=='running')throw new Error('任务已结束');job.status='cancelled';this.save(job);const handle=this.running.get(id);if(handle){clearTimeout(handle.timer);this.kill(handle.child);this.running.delete(id);}return job;}
 accepted(id:string,artifactId:string){const job=this.get(id);if(job.status!=='ready')throw new Error('任务尚不可接受');job.status='accepted';job.acceptedId=artifactId;this.save(job);return job;}
 shutdown(){for(const id of this.running.keys())this.cancel(id);}
}
