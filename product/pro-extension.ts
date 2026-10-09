import path from 'node:path';
import {pathToFileURL} from 'node:url';

interface GenerationInput {provider:'codex'|'claude';type:'module'|'template'|'article';prompt:string;templateId?:string;}
interface Job {id:string;status:string;error?:string;}
export interface ExtensionContext {
 dataDir:string;
 runner:{start(input:GenerationInput):Job;get(id:string):Job;cancel(id:string):Job};
 artifacts:{list():unknown[]};
}
interface Extension {shutdown():void;route(method:string,url:URL,input:()=>Promise<unknown>):Promise<unknown>;}
/** Only the machine owner can configure executable extensions. No HTTP installer. */
export async function loadProExtension(context:ExtensionContext,config=process.env):Promise<Extension>{
 const source=config.CONTENT_DESK_PRO_MODULE;
 if(!source)return {shutdown(){},async route(method,url){
  if(method==='GET'&&url.pathname==='/api/pro/status')return {available:false,active:false};
  throw new Error('尚未安装 Pro 扩展');
 }};
 if(!path.isAbsolute(source))throw new Error('Pro 扩展必须使用本机绝对路径');
 const publicKey=config.CONTENT_DESK_PRO_PUBLIC_KEY;
 if(!publicKey)throw new Error('Pro 扩展缺少授权验证公钥');
 const module=await import(pathToFileURL(source).href);
 if(typeof module.createProExtension!=='function')throw new Error('Pro 扩展入口无效');
 const extension=await module.createProExtension({...context,publicKey});
 if(!extension||typeof extension.route!=='function'||typeof extension.shutdown!=='function')throw new Error('Pro 扩展接口无效');
 return extension;
}
