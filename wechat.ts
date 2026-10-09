import fs from 'node:fs/promises';
import sharp from 'sharp';
import { load } from 'cheerio';
import { LocalStore, type Snapshot } from './store';

type Json = Record<string, unknown>;
export interface Credentials { appid: string; secret: string; author?: string; }
/** Cache only validated credentials in memory for 60 seconds; never persist secrets. */
export function createCredentialReader(read:(file:string)=>Promise<string>,now=Date.now){
  const cache=new Map<string,{value:Credentials;expires:number}>();
  const pending=new Map<string,Promise<Credentials>>();
  return async (file:string):Promise<Credentials>=>{
    const cached=cache.get(file);if(cached&&cached.expires>now())return {...cached.value};
    cache.delete(file);
    let request=pending.get(file);
    if(!request){
      request=(async()=>{
        try{
          const c=JSON.parse(await read(file));
          const appid=c?.appid||c?.app_id||c?.wechat_appid,secret=c?.appsecret||c?.app_secret||c?.secret||c?.wechat_appsecret;
          if(typeof appid!=='string'||typeof secret!=='string'||!appid||!secret)throw new Error('配置需包含 appid 和 appsecret');
          const value={appid,secret,author:typeof c.author==='string'?c.author:undefined};
          cache.set(file,{value,expires:now()+60_000});return value;
        }catch(error){if(error instanceof SyntaxError)throw new Error('公众号配置不是有效 JSON');throw error;}
      })();pending.set(file,request);
    }
    try{return {...await request};}finally{if(pending.get(file)===request)pending.delete(file);}
  };
}
const readCredentials=createCredentialReader(async file=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([
    fs.readFile(file,{encoding:'utf8',signal:controller.signal}),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Error('公众号配置读取超过 3 秒，请稍后点击重新检查连接；若持续失败，请检查配置文件的本地可用性'));controller.abort();},3000);})
  ]);}finally{clearTimeout(timer);}
});
export async function credentials(): Promise<Credentials> {
  if(process.env.WECHAT_MP_APPID&&process.env.WECHAT_MP_SECRET)return {appid:process.env.WECHAT_MP_APPID,secret:process.env.WECHAT_MP_SECRET,author:process.env.WECHAT_MP_AUTHOR};
  const file=process.env.WECHAT_CONFIG_PATH;
  if(!file)throw new Error('尚未配置公众号：请在启动服务时设置 WECHAT_CONFIG_PATH，或 WECHAT_MP_APPID / WECHAT_MP_SECRET');
  return readCredentials(file);
}
export async function normalizeImage(data: string): Promise<Buffer> {
  const match=data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw new Error('图片格式无效');
  const bytes=Buffer.from(match[2],'base64');
  const metadata=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();
  if (!metadata.width || !metadata.height) throw new Error('图片损坏');
  if (bytes.length < 1_000_000 && ['png','jpeg'].includes(metadata.format||'')) return bytes;
  for (const width of [1600,1200,900]) { const output=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize({width,withoutEnlargement:true}).flatten({background:'#101113'}).jpeg({quality:82}).toBuffer(); if(output.length<1_000_000)return output; }
  throw new Error('图片压缩后仍超过 1MB');
}
const API='https://api.weixin.qq.com/cgi-bin/';
const normalizedText=(html:string)=>load(html).text().replace(/\s+/g,'');
export function verifyDraft(expected: string, actual: string, expectedTitle: string, actualTitle: string, thumb: string, actualThumb: string) {
  const a=load(expected),b=load(actual);
  // 微信回读会把正文图 URL 的尺寸段重写（如 /0 -> /640），归一化后比较基础路径与顺序
  const canon=(src:string)=>src.replace(/^https?:/,'').replace(/\/(sz_)?mmbiz_/,'/mmbiz_').replace(/\/\d+(\?from=appmsg)?$/,'$1');
  const pick=($:ReturnType<typeof load>,el:unknown)=>$(el as never).attr('src')||$(el as never).attr('data-src')||'';
  const imgsA=a('img').map((_,el)=>canon(pick(a,el))).get(),imgsB=b('img').map((_,el)=>canon(pick(b,el))).get();
  if(expectedTitle!==actualTitle || thumb!==actualThumb || normalizedText(expected)!==normalizedText(actual) || JSON.stringify(imgsA)!==JSON.stringify(imgsB)) throw new Error('草稿已创建，但回读内容不一致（标题、文字、图片顺序或封面），请到微信后台检查；不会重复创建');
}
export class DraftPublisher {
  private busy=false;
  constructor(private store:LocalStore, private getCredentials=credentials, private transport:typeof fetch=fetch) {}
  private async call(endpoint:string, init:RequestInit):Promise<Json> {
    let response:Response;
    try {response=await this.transport(API+endpoint,{...init,signal:AbortSignal.timeout(25_000)});}catch{throw new Error('微信接口连接超时或中断');}
    if(!response.ok)throw new Error('微信接口 HTTP '+response.status);
    const data=await response.json() as Json;
    if(data.errcode)throw new Error('微信错误 '+String(data.errcode)+(data.errcode===40164?'：出口 IP 未加入公众号白名单。'+String(data.errmsg||'').replace(/access_token=[^\s&]+/g,'access_token=[redacted]').slice(0,220):'：请核对账号接口权限和配置'));
    return data;
  }
  async push(revision:string,targetMediaId?:string) {
    if(this.busy)throw new Error('已有草稿同步进行中，请稍后再试');
    this.busy=true;
    try{return await this.run(revision,targetMediaId);}finally{this.busy=false;}
  }
  private async run(revision:string,targetMediaId?:string) {
    const snapshot=this.store.get(revision),savedReceipt=this.store.receipt(revision);
    const prior=savedReceipt?.status==='verified'&&!this.store.isCurrentReceipt(revision)?{...savedReceipt,status:'outdated',mediaId:undefined,targetMediaId:savedReceipt.mediaId}:savedReceipt;
    if(prior?.status==='verified')return prior;
    const unresolved=this.store.list().find(s=>s.revision!==revision&&s.issueId===snapshot.issueId&&s.seriesId===snapshot.seriesId&&s.receipt&&['uncertain','created','working'].includes(s.receipt.status));
    if(unresolved)throw new Error('同一文章存在未确认同步版本 '+unresolved.revision.slice(0,8)+'，请先恢复该版本核对回执');
    if(prior?.status==='uncertain'||(prior?.status==='working'&&prior.stage==='draft/add'))throw new Error('上次提交结果未确认，请先在微信后台核对，已阻止重复创建');
    let stage='校验本地内容',mediaId=prior?.mediaId;
    targetMediaId=prior?.targetMediaId||targetMediaId;
    const mark=(status:'working'|'created'='working')=>this.store.record(revision,{stage,status,mediaId,targetMediaId});
    try {
      mark();
      const check=load(snapshot.html);
      if(check('h1').first().text().trim()!==snapshot.title)throw new Error('正文标题与消息标题不一致');
      if(/点击这里开始|待补充|TODO|\{\{.+?\}\}/.test(check('article').text()))throw new Error('正文仍包含占位文字');
      const config=await this.getCredentials();
      const $=load(snapshot.html,null,false);
      const originals=$('img').map((_,el)=>$(el).attr('src')||'').get();
      const imageMap=new Map<string,Buffer>();
      for(const src of new Set([...originals,snapshot.cover]))if(src.startsWith('data:'))imageMap.set(src,await normalizeImage(src));
      stage='获取微信访问令牌';mark();
      const tokenResult=await this.call('stable_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:config.appid,secret:config.secret,force_refresh:false})});
      const token=tokenResult.access_token;if(typeof token!=='string')throw new Error('微信未返回有效访问令牌');
      let prepared:string,thumb:string;
      const preparedPath=this.store.dir+'/'+revision+'.prepared.json';
      if(mediaId){const saved=JSON.parse(await fs.readFile(preparedPath,'utf8'));prepared=saved.html;thumb=saved.thumb;}
      else {
        const urls=new Map<string,string>();let count=0;
        for(const src of new Set(originals)) {
          if(!src.startsWith('data:')){urls.set(src,src);continue;}
          stage='上传正文图片 '+(++count)+'/'+originals.length;mark();
          const buffer=imageMap.get(src)!;const form=new FormData();form.append('media',new Blob([new Uint8Array(buffer)]),'image.'+(buffer[0]===137?'png':'jpg'));
          const data=await this.call('media/uploadimg?access_token='+encodeURIComponent(token),{method:'POST',body:form});
          if(typeof data.url!=='string'||!/^https?:\/\/[^/]*\.qpic\.cn\//.test(data.url))throw new Error('微信未返回有效正文图片地址');urls.set(src,data.url);
        }
        $('img').each((_,el)=>{$(el).attr('src',urls.get($(el).attr('src')!)!);});
        // Strip editor-only markers only after header and image validation.
        $('*').removeAttr('data-block').removeAttr('data-content-header').removeAttr('data-source').removeAttr('data-signature').removeAttr('data-sources');
        // 空段落（仅 <br>/空白、无媒体）在微信端渲染为空行：推送前一律剔除（含历史快照）。
        $('p').each((_,el)=>{const $el=$(el);const text=$el.text().replace(/\u00a0/g,'').trim();if(!text&&!$el.find('img,video,iframe').length)$el.remove();});
        prepared=$.html();if(prepared.length>=20000||Buffer.byteLength(prepared)>=1_000_000)throw new Error('图文超出微信长度限制，请精简正文或样式');
        stage='上传当前封面';mark();const form=new FormData(),cover=imageMap.get(snapshot.cover)!;form.append('media',new Blob([new Uint8Array(cover)]),'cover.'+(cover[0]===137?'png':'jpg'));
        const coverResult=await this.call('material/add_material?type=image&access_token='+encodeURIComponent(token),{method:'POST',body:form});
        if(typeof coverResult.media_id!=='string')throw new Error('微信未返回封面素材编号');thumb=coverResult.media_id;
        this.store.atomic(preparedPath,{html:prepared,thumb});
        stage=targetMediaId?'draft/update':'draft/add';mark();
        const article={article_type:'news',title:snapshot.title,author:(config.author||'').slice(0,16),digest:snapshot.digest||'',content:prepared,thumb_media_id:thumb,show_cover_pic:0,need_open_comment:0,only_fans_can_comment:0};
        if(targetMediaId){
          // Persist the target before writing: an interrupted update must only read back on retry.
          mediaId=targetMediaId;mark('created');
          await this.call('draft/update?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_id:targetMediaId,index:0,articles:article})});
        }else{
          const created=await this.call('draft/add?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({articles:[article]})});
          if(typeof created.media_id!=='string')throw new Error('微信未返回草稿编号');mediaId=created.media_id;
        }
        mark('created');
      }
      stage='draft/get';mark('created');
      const readback=await this.call('draft/get?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_id:mediaId})});
      const article=(readback.news_item as Array<Record<string,string>>)?.[0];if(!article)throw new Error('草稿已创建但回读失败，稍后点击仅重试回读');
      if(snapshot.digest&&article.digest!==snapshot.digest)throw new Error('草稿摘要回读不一致，请核对微信后台');
      verifyDraft(prepared,article.content,snapshot.title,article.title,thumb,article.thumb_media_id);
      return this.store.record(revision,{stage:'回读核对完成',status:'verified',mediaId});
    }catch(error){const message=error instanceof Error?error.message:'同步失败';this.store.record(revision,{stage,targetMediaId,status:mediaId?'created':stage==='draft/add'?'uncertain':'failed',mediaId,error:message});throw new Error(stage+'：'+message);}
  }
}
