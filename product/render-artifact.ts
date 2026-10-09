import {load} from 'cheerio';
import {defaults,styleRules,type Settings} from '../article-format';
import {parseArtifact,type ContentArtifact} from './content-contract';
export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderModules(input:ContentArtifact,assets:Record<string,string>={}){
 const artifact=parseArtifact(input);return artifact.modules.map(m=>{const text=escapeHtml(m.text).replace(/\n/g,'<br>');switch(m.kind){case 'heading':return `<h2>${text}</h2>`;case 'quote':return `<blockquote>${text}</blockquote>`;case 'list':return `<ul>${m.items.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>`;case 'sources':return `<blockquote data-sources="1">${text}</blockquote>`;case 'signature':return `<p>${text}</p>`;case 'image':{const src=assets[m.assetId];if(!src||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src))throw new Error('缺少图片素材：'+m.assetId);return `<figure><img src="${src}" alt="${escapeHtml(m.alt)}"><figcaption>${text}</figcaption></figure>`;}default:return `<p>${text}</p>`;}}).join('');
}
export function articleHtml(artifact:ContentArtifact,logo:string,cover:string,settings:Settings=defaults){
 if(artifact.type!=='article')throw new Error('只能将文章加入编辑器');
 const $=load(`<section data-content-header="1"><section data-block="logo"><img src="${logo}" alt="品牌标志"></section><section data-block="cover"><img src="${cover}" alt="文章封面"></section><section data-block="caption"><p>${escapeHtml(String(settings.caption))}</p></section></section><article><section><h1>${escapeHtml(artifact.title)}</h1>${renderModules(artifact)}</section></article><section data-signature="1">${escapeHtml(String(settings['signature-text']))}</section>`,null,false);
 for(const [selector,style] of styleRules(settings))$(selector).attr('style',style);return $.html();
}
