import fs from 'node:fs';
import os from 'node:os';
import {studioService} from './product/studio-api';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LocalStore, type SnapshotInput } from './store';
import { DraftPublisher, credentials } from './wechat';

const root=path.dirname(fileURLToPath(import.meta.url));
const index=process.argv.indexOf('--port');
const port=index>=0?Number(process.argv[index+1]):8787;
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('无效端口');
const store=new LocalStore(process.env.WORKBENCH_DATA_DIR||path.join(os.homedir(),'.content-desk'));
const publisher=new DraftPublisher(store);
const studio=await studioService(store);
const csrf=randomBytes(32).toString('hex');
const hosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);
const origins=new Set([...hosts].map(host=>'http://'+host));
let activeRevision:string|null=null;
function json(response:http.ServerResponse,status:number,value:unknown){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));}
async function body(request:http.IncomingMessage){
  if(!request.headers['content-type']?.startsWith('application/json'))throw new Error('仅支持 JSON 请求');
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of request){length+=chunk.length;if(length>20*1024*1024)throw new Error('保存内容超过 20MB，请压缩图片');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server=http.createServer(async(request,response)=>{
  if(!hosts.has(request.headers.host||'')){json(response,403,{error:'仅允许本机访问'});return;}
  try{
    const url=new URL(request.url||'/','http://127.0.0.1:'+port);
    if(request.method==='POST'&&(!origins.has(request.headers.origin||'')||request.headers['x-workbench-token']!==csrf)){json(response,403,{error:'页面已过期或请求来源无效，请刷新工作台'});return;}
    if(url.pathname.startsWith('/api/pro/')){json(response,200,await studio.proRoute(request.method||'GET',url,()=>body(request)));return;}
    if(url.pathname.startsWith('/api/studio/')){json(response,200,await studio.route(request.method||'GET',url,()=>body(request)));return;}
    if(request.method==='GET'&&url.pathname==='/api/bootstrap'){
      let configured=false,configurationError='';try{await credentials();configured=true;}catch(e){configurationError=(e as Error).message;}
      json(response,200,{token:csrf,snapshots:store.list(),catalog:store.catalog(),configured,configurationError,activeRevision});return;
    }
    if(request.method==='GET'&&url.pathname==='/api/library'){json(response,200,{snapshots:store.list(),catalog:store.catalog()});return;}
    if(request.method==='GET'&&url.pathname==='/api/config-status'){
      let configured=false,configurationError='';try{await credentials();configured=true;}catch(e){configurationError=(e as Error).message;}
      json(response,200,{configured,configurationError});return;
    }
    if(request.method==='GET'&&url.pathname==='/api/template'){json(response,200,store.template(url.searchParams.get('seriesId')||''));return;}
    if(request.method==='POST'&&url.pathname==='/api/template'){json(response,200,store.saveTemplate(await body(request)));return;}
    if(request.method==='POST'&&url.pathname==='/api/review'){const input=await body(request);json(response,200,store.reviewVersion(input.revision,input.status));return;}
    if(request.method==='GET'&&url.pathname==='/api/health'){json(response,200,{ok:true,activeRevision,instanceId:process.env.CONTENT_DESK_INSTANCE_ID||''});return;}
    if(request.method==='GET'&&url.pathname==='/api/snapshot'){json(response,200,store.get(url.searchParams.get('revision')||''));return;}
    if(request.method==='GET'&&url.pathname==='/api/cover'){
      const source=store.get(url.searchParams.get('revision')||'').cover;const [header,data]=source.split(',');
      response.writeHead(200,{'Content-Type':header.slice(5,-7),'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});response.end(Buffer.from(data,'base64'));return;
    }
    if(request.method==='GET'&&url.pathname==='/api/receipt'){json(response,200,store.receipt(url.searchParams.get('revision')||''));return;}
    if(request.method==='GET'&&url.pathname==='/api/export'){
      const snapshot=store.get(url.searchParams.get('revision')||'');
      response.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="article-'+snapshot.revision.slice(0,8)+'.json"','Cache-Control':'no-store'});response.end(JSON.stringify(snapshot,null,2));return;
    }
    if(request.method==='POST'&&url.pathname==='/api/save'){
      const snapshot=store.save(await body(request) as SnapshotInput);
      json(response,200,{revision:snapshot.revision,savedAt:snapshot.savedAt,imageCount:snapshot.imageCount,receipt:store.receipt(snapshot.revision),review:store.review(snapshot.revision)});return;
    }
    if(request.method==='POST'&&url.pathname==='/api/catalog'){store.saveCatalog(await body(request));json(response,200,{ok:true});return;}
    if(request.method==='POST'&&url.pathname==='/api/push-draft'){
      const input=await body(request);if(typeof input.revision!=='string'){json(response,400,{error:'请先保存当前完整图文，再推送已保存版本'});return;}
      if(activeRevision){json(response,409,{error:'草稿同步正在进行，请稍后再试'});return;}
      const snapshot=store.get(input.revision);
      const target=input.forceNew===true?undefined:store.list().find(s=>s.issueId===snapshot.issueId&&s.seriesId===snapshot.seriesId&&s.receipt?.status==='verified')?.receipt?.mediaId;
      const prior=store.receipt(input.revision);
      const unresolved=store.list().find(s=>s.revision!==input.revision&&s.issueId===snapshot.issueId&&s.seriesId===snapshot.seriesId&&s.receipt&&['uncertain','created','working'].includes(s.receipt.status));
      if(unresolved){json(response,409,{error:'同一文章存在未确认同步版本 '+unresolved.revision.slice(0,8)+'，请先恢复该版本核对回执'});return;}
      if(prior?.status==='verified'&&store.isCurrentReceipt(input.revision)){activeRevision=null;json(response,200,prior);return;}
      if(prior?.status==='uncertain'||(prior?.status==='working'&&prior.stage==='draft/add')){activeRevision=null;json(response,409,{error:'上次提交结果未确认，请先到微信后台核对，已阻止重复创建'});return;}
      activeRevision=input.revision;
      void publisher.push(input.revision,target).catch(()=>{}).finally(()=>{activeRevision=null;});
      json(response,202,{queued:true,revision:input.revision});return;
    }
    if(request.method==='GET'&&url.pathname==='/api/automation-log'){
      const logPath=process.env.AUTOMATION_LOG_PATH||path.join(store.dir,'automation.md');
      try{
        const text=fs.readFileSync(logPath,'utf8');
        const entries:Array<{time:string;title:string;body:string[]}>=[];let cur:{time:string;title:string;body:string[]}|null=null;
        for(const line of text.split('\n')){
          const m=line.match(/^## (.+)$/);
          if(m){
            if(cur)entries.push(cur);
            const header=m[1];const tm=header.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*(.*)$/);
            cur={time:tm?(tm[1]+' '+(tm[2]||'')):header,title:tm?tm[3]:header,body:[]};
          }else if(cur)cur.body.push(line);
        }
        if(cur)entries.push(cur);
        const parsed=entries.slice(0,15).map(e=>{
          const body=e.body.join('\n');
          const dm=body.match(/media_id[=:：\s]+(u_[A-Za-z0-9_-]{8,})/);
          const am=body.match(/(?:产出：|今日稿|已为今日稿)《(.+?)》/)||body.match(/《(.+?)》/);
          const cm=body.match(/草稿成功数：\s*(\d+)/);
          const draftCount=cm?Number(cm[1]):null;
          let badge='info';
          if(draftCount&&draftCount>0)badge='success';
          else if(/40164|阻塞|停止|门禁不通过/.test(body))badge='blocked';
          else if(/未送达|失败/.test(body))badge='warn';
          let task='运行记录';
          if(/自动触发/.test(e.title))task='每日自动化 · 热点稿→排版→草稿同步';
          else if(/补充/.test(e.title))task='工作台补充配置';
          else if(/提醒通道|Clawbot|审核提醒/.test(e.title))task='审核提醒通道';
          else if(/质检/.test(e.title))task='长文质检与同步';
          else if(/热点稿|热点深度稿/.test(e.title))task='每日热点稿';
          else task=e.title.slice(0,24);
          const reminders=[];if(/提醒[^。]*未送达/.test(body))reminders.push('提醒未送达');
          if(/40164/.test(body))reminders.push('IP白名单');
          return{time:e.time,task,badge,article:am?am[1]:'',mediaId:dm?dm[1]:'',draftCount,reminders,detail:(e.title+'\n'+body).trim().slice(0,1500)};
        });
        json(response,200,{total:entries.length,entries:parsed});
      }catch{json(response,404,{error:'自动化日志读取失败'});}
      return;
    }
    if(request.method==='GET'&&url.pathname.startsWith('/fonts/')){
      const file=path.join(root,'fonts',path.basename(url.pathname));
      if(!fs.existsSync(file)||!file.endsWith('.woff2')&&!file.endsWith('.css')){json(response,404,{error:'字体不存在'});return;}
      const mime=file.endsWith('.css')?'text/css; charset=utf-8':'font/woff2';
      response.writeHead(200,{'Content-Type':mime,'Cache-Control':'private, max-age=604800, immutable'});response.end(fs.readFileSync(file));return;
    }
    if(request.method==='GET'&&url.pathname==='/api/series-cover'){
      const id=url.searchParams.get('id')||'';
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)){json(response,400,{error:'无效系列编号'});return;}
      for(const ext of ['.jpg','.jpeg','.png','.webp']){
        const file=path.join(store.dir,'series-covers',id+ext);
        if(fs.existsSync(file)){const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';response.writeHead(200,{'Content-Type':mime,'Cache-Control':'private, max-age=300'});response.end(fs.readFileSync(file));return;}
      }
      json(response,404,{error:'该系列暂无封面'});return;
    }
    if(request.method==='GET'&&(url.pathname==='/editor'||url.pathname==='/preview.html'||url.pathname==='/'||url.pathname==='/studio')){
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.qpic.cn; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"});response.end(fs.readFileSync(path.join(root,['/','/studio'].includes(url.pathname)?'studio.html':'preview.html'),'utf8'));return;
    }
    json(response,404,{error:'页面或接口不存在'});
  }catch(error){const message=error instanceof Error?error.message:'操作失败';json(response,400,{error:/ENOENT|EACCES/.test(message)?'找不到保存版本或本地目录不可写':message});}
});
server.requestTimeout=30_000;
server.listen(port,'127.0.0.1',()=>console.log('工作台：http://127.0.0.1:'+port+'/preview.html（本机单用户）'));
function shutdown(){studio.shutdown();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
