import type {Job} from './agent-runner';

interface ProStatus {available:boolean;active:boolean;deviceId?:string;features?:string[];message?:string;updatesUntil?:string;}
interface Entry {id:string;input:{prompt:string;type:string;provider:string};status:string;scheduledAt:string;jobId?:string;error?:string;}
interface Hooks {
 api<T>(url:string,value?:unknown):Promise<T>;
 message(text:string,error?:boolean):void;
 context():{provider:string;type:string;templateId?:string};
 preview(job:Job):boolean;
}
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const states:Record<string,string>={queued:'等待执行',running:'正在生成',ready:'等待检查',accepted:'已保存',failed:'生成失败',cancelled:'已取消'};
export function proUI(hooks:Hooks){
 let status:ProStatus={available:false,active:false},timer:ReturnType<typeof setTimeout>|undefined;
 const fail=(error:unknown)=>{const message=error instanceof Error?error.message:String(error);$('pro-feedback').textContent=message;hooks.message(message,true);};
 const allows=(feature:string)=>status.active&&!!status.features?.includes(feature);
 async function refresh(){
  status=await hooks.api<ProStatus>('/api/pro/status');
  $('pro-panel').hidden=!status.available;$('edition-plans').hidden=status.available;
  $('edition').textContent=status.available?'Pro 工作流':'版本权益';
  $('edition-heading').textContent=status.available?'Pro 工作流':'选择适合你的创作方式';
  $('edition-badge').textContent=status.active?'PRO':'COMMUNITY';
  if(!status.available)return;
  $('pro-license-status').textContent=status.active?'Pro 已激活 · 功能更新至 '+new Date(status.updatesUntil!).toLocaleDateString():status.message||'等待导入授权';
  $<HTMLInputElement>('pro-device').value=status.deviceId||'';
  $('pro-workflow').hidden=!allows('batch-generation');
  $('pro-schedule-label').hidden=!allows('scheduled-generation');
  $('pro-export').hidden=!allows('bulk-export');
  if(!allows('batch-generation'))return;
  const {entries}=await hooks.api<{entries:Entry[]}>('/api/pro/queue');
  $('pro-queue-count').textContent=entries.filter(e=>['queued','running'].includes(e.status)).length+' 项待完成';
  $('pro-queue').innerHTML=entries.length?entries.slice().reverse().map(entry=>`<li><div class="pro-task-title"><b>${esc(entry.input.prompt.slice(0,100))}</b><span>${states[entry.status]||esc(entry.status)}</span></div><p>${entry.input.provider} · ${esc(new Date(entry.scheduledAt).toLocaleString())}</p>${entry.error?`<p class="pro-error">${esc(entry.error)}</p>`:''}<div class="pro-row-actions">${['ready','accepted'].includes(entry.status)&&entry.jobId?`<button data-preview="${esc(entry.jobId)}">${entry.status==='accepted'?'查看已保存结果':'检查生成结果'}</button>`:''}${['queued','running'].includes(entry.status)?`<button data-cancel="${esc(entry.id)}">取消任务</button>`:''}${['failed','cancelled'].includes(entry.status)?`<button data-retry="${esc(entry.id)}">重新生成</button>`:''}</div></li>`).join(''):'<li class="muted">暂无批量任务。每行写一个选题，按顺序交给 Agent。</li>';
  $('pro-queue').querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.onclick=async()=>{
   button.disabled=true;
   try{
    if(button.dataset.preview){const job=await hooks.api<Job>('/api/studio/job?id='+encodeURIComponent(button.dataset.preview));if(job.result&&hooks.preview(job))$<HTMLDialogElement>('dialog').close();}
    else if(button.dataset.cancel){await hooks.api('/api/pro/cancel',{id:button.dataset.cancel});await refresh();}
    else if(button.dataset.retry){if(!confirm('重新生成会再次调用你的 Agent 账号，继续吗？'))return;await hooks.api('/api/pro/retry',{id:button.dataset.retry});await refresh();}
   }catch(e){fail(e);}finally{button.disabled=false;}
  });
 }
 async function poll(){clearTimeout(timer);try{await refresh();}catch(e){fail(e);}if($<HTMLDialogElement>('dialog').open)timer=setTimeout(()=>void poll(),2500);}
 $('edition').onclick=()=>{$<HTMLDialogElement>('dialog').showModal();void poll();};
 $('dialog').addEventListener('close',()=>clearTimeout(timer));
 $('pro-license-import').onclick=()=>$<HTMLInputElement>('pro-license-file').click();
 $<HTMLInputElement>('pro-license-file').onchange=async()=>{
  try{const file=$<HTMLInputElement>('pro-license-file').files?.[0];if(!file)return;if(file.size>65536)throw new Error('授权文件超过 64KB');await hooks.api('/api/pro/license',JSON.parse(await file.text()));$('pro-feedback').textContent='授权已验证';await refresh();}
  catch(e){fail(e);}finally{$<HTMLInputElement>('pro-license-file').value='';}
 };
 $('pro-enqueue').onclick=async()=>{
  const button=$<HTMLButtonElement>('pro-enqueue');button.disabled=true;
  try{
   const topics=$<HTMLTextAreaElement>('pro-topics').value.split('\n').map(s=>s.trim()).filter(Boolean);
   if(!topics.length||topics.length>50)throw new Error('请填写 1–50 个选题，每行一个');
   const context=hooks.context(),requirements=$<HTMLTextAreaElement>('pro-requirements').value.trim();
   const time=allows('scheduled-generation')?$<HTMLInputElement>('pro-time').value:'';
   await hooks.api('/api/pro/queue',{inputs:topics.map(topic=>({...context,prompt:topic+(requirements?'\n\n共同要求：\n'+requirements:'')})),...(time?{scheduledAt:new Date(time).toISOString()}:{})});
   $<HTMLTextAreaElement>('pro-topics').value='';$('pro-feedback').textContent=topics.length+' 个任务已加入队列；生成后逐篇检查并保存。';await refresh();
  }catch(e){fail(e);}finally{button.disabled=false;}
 };
 $('pro-export').onclick=async()=>{
  try{const bundle=await hooks.api('/api/pro/export'),url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='content-desk-library.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){fail(e);}
 };
 return {refresh};
}
