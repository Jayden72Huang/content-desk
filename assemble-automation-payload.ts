import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
import { defaults,styleRules,templateSettings,type Settings } from './article-format';
import { cleanHtml,type SnapshotInput } from './store';
interface TemplateInput{revision?:string;seriesId:string;settings:Settings;logo?:string;html?:string}
export function assembleArticle(input:{articleDir:string;template:TemplateInput;issueId:string;title:string;digest?:string;coverName?:string}):SnapshotInput{
 const {articleDir,template,issueId,title}=input;
 const embed=(src:string)=>{if(/^data:image\//.test(src)||/^https:\/\/[^/]*\.qpic\.cn\//.test(src))return src;
   const base=fs.realpathSync(articleDir),file=fs.realpathSync(path.resolve(base,src));if(!file.startsWith(base+path.sep))throw new Error('图片路径必须位于当前文章目录内');
   const ext=path.extname(file).toLowerCase(),mime=({'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'} as Record<string,string>)[ext];if(!mime)throw new Error('不支持的图片格式：'+src);return 'data:image/'+mime+';base64,'+fs.readFileSync(file).toString('base64');};
 const source=load(fs.readFileSync(path.join(articleDir,'wechat-rendered.html'),'utf8'),null,false);
 source('[data-content-header],[data-signature]').remove();
 const section=source('article>section').first().length?source('article>section').first():source('section').first();
 if(!section.length||!section.find('h1').length)throw new Error('文章必须包含完整正文和 h1 标题');
 section.find('h1').first().text(title);section.find('img').each((_,el)=>{const src=source(el).attr('src');if(!src)throw new Error('正文图片缺少路径');source(el).attr('src',embed(src));});
 const settings:Settings={...defaults,...templateSettings(template.settings),'template-version':template.revision||'legacy'};
 section.find('p').filter((_,el)=>source(el).text().replace(/\s+/g,'')===String(settings.caption).replace(/\s+/g,'')).remove();
 const prior=load(template.html||'',null,false),logo=template.logo||prior('[data-block="logo"] img').attr('src');if(!logo)throw new Error('模板缺少品牌 Logo');
 const cover=embed(input.coverName||'article.jpg');
 const $=load('<section data-content-header="1"><section data-block="logo"><img></section><section data-block="cover"><img></section><section data-block="caption"><p></p></section></section><article><section></section></article><section data-signature="1"></section>',null,false);
 $('article>section').html(section.html()||'');$('[data-block="logo"] img').attr({src:logo,alt:'Content Desk'});$('[data-block="cover"] img').attr({src:cover,alt:'本期封面'});$('[data-block="caption"] p').text(String(settings.caption));$('[data-signature]').text(String(settings['signature-text']));
 styleRules(settings).forEach(([selector,style])=>$(selector).attr('style',style));
 String(settings['block-order']).split(',').forEach(key=>$('[data-content-header]').append($('[data-block="'+key+'"]')));
 return {issueId,seriesId:template.seriesId,title,html:cleanHtml($.html()),cover,settings,...(input.digest!==undefined?{digest:input.digest}:{})};
}
if(import.meta.main){
 const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error('缺少环境变量 '+name);return v;};
 const supplied:TemplateInput=JSON.parse(fs.readFileSync(required('TEMPLATE_SNAPSHOT'),'utf8'));
 const seriesId=process.env.SERIES_ID||supplied.seriesId;if(!seriesId||!/^[\w-]+$/.test(seriesId))throw new Error('模板缺少有效系列编号');
 const currentTemplate=path.join(process.env.WORKBENCH_DATA_DIR||path.join(os.homedir(),'.content-desk'),seriesId+'.template.json');
 const template:TemplateInput=fs.existsSync(currentTemplate)?JSON.parse(fs.readFileSync(currentTemplate,'utf8')):{...supplied,seriesId};
 const payload=assembleArticle({articleDir:required('ARTICLE_DIR'),template,issueId:required('ISSUE_ID'),title:required('ARTICLE_TITLE'),digest:process.env.ARTICLE_DIGEST,coverName:process.env.ARTICLE_COVER});
 fs.writeFileSync(required('PAYLOAD_OUTPUT'),JSON.stringify(payload),{mode:0o600});
 if(process.argv.includes('--save')){
   const base=process.env.WORKBENCH_URL||'http://127.0.0.1:8787';const u=new URL(base);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.protocol!=='http:')throw new Error('只允许入库到本机工作台');
   const b=await fetch(base+'/api/bootstrap').then(r=>r.json()) as {token:string};
   const response=await fetch(base+'/api/save',{method:'POST',headers:{'Content-Type':'application/json',Origin:u.origin,'X-Workbench-Token':b.token},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));console.log(JSON.stringify({saved:true,...result}));
 }else console.log(JSON.stringify({issueId:payload.issueId,seriesId,templateVersion:template.revision||'legacy',imageCount:load(payload.html)('img').length,output:process.env.PAYLOAD_OUTPUT}));
}
