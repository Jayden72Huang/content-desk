export type Settings = Record<string,string|boolean>;
export const defaults:Settings={theme:'deep','solid-color':'#101113',accent:'yellow','body-size':'16','body-line':'1.9','body-gap':'18','body-padding':'20','block-order':'logo,cover,caption',caption:'让值得分享的想法，成为好内容。','caption-size':'16','cover-gap':'12','signature-enabled':true,'signature-text':'CONTENT DESK'};
export const templateKeys=Object.keys(defaults);
export function templateSettings(s:Settings):Settings{return Object.fromEntries(templateKeys.map(k=>[k,s[k]??defaults[k]]));}
export function palette(s:Settings){return {bg:({deep:'#101113',nebula:'#0d1b2e',eclipse:'#000000',stardust:'#0b211d',none:'transparent',solid:/^#[a-f\d]{6}$/i.test(String(s['solid-color']))?String(s['solid-color']):'#101113'} as Record<string,string>)[String(s.theme)]||'#101113',ink:s.theme==='none'?'#333333':'#e8edf5',muted:s.theme==='none'?'#666666':'#a5b2bc',accent:s.accent==='teal'?'#00d4c8':'#ffd500'};}
const number=(s:Settings,k:string,min:number,max:number)=>Math.min(max,Math.max(min,Number.isFinite(Number(s[k]))?Number(s[k]):Number(defaults[k])));
export function styleRules(s:Settings):Array<[string,string]>{
 const p=palette(s),size=number(s,'body-size',14,22),line=number(s,'body-line',1.4,2.5),gap=number(s,'body-gap',8,36),pad=number(s,'body-padding',12,36);
 return [
 ['article',`background:${p.bg};color:${p.ink};`],['article>section',`box-sizing:border-box;margin:0;padding:24px ${pad}px 28px;background:${p.bg};color:${p.ink};font-family:'PingFang SC','Microsoft YaHei',sans-serif;font-size:${size}px;line-height:${line};`],
 ['article p',`margin:0 0 ${gap}px;padding:0;color:${p.ink};font-size:${size}px;line-height:${line};text-align:left;`],
 ['article h1',`margin:0 0 24px;padding:0 0 18px;color:${p.ink};font-size:26px;font-weight:800;line-height:1.4;border-bottom:3px solid ${p.accent};`],
 ['article h2,article h3',`margin:30px 0 18px;padding:8px 0 8px 12px;color:${p.ink};font-size:21px;font-weight:700;line-height:1.5;border-left:4px solid ${p.accent};background:transparent;`],
 ['article blockquote',`margin:22px 0;padding:14px 16px;color:${p.ink};font-size:${size}px;line-height:${line};border-left:3px solid ${p.accent};background:${s.theme==='none'?'#f3f4f2':'#1b2327'};`],
 ['article strong,article b',`font-weight:700;color:${p.accent};`],['article ul,article ol',`padding-left:24px;margin:18px 0;color:${p.ink};font-size:${size}px;line-height:${line};`],['article li',`margin:8px 0;color:${p.ink};`],
 ['article figure',`margin:24px 0;padding:0;`],['article figcaption',`margin:8px 0 20px;color:${p.muted};font-size:12px;line-height:1.7;text-align:center;`],['article a',`color:${p.accent};text-decoration:underline;overflow-wrap:anywhere;`],
 ['[data-content-header]',`display:block;width:100%;margin:0;padding:0;box-sizing:border-box;background:${p.bg};`],['[data-block]',`display:block;width:100%;margin:0;padding:0;background:${p.bg};box-sizing:border-box;`],
 ['[data-block="caption"]',`display:block;margin:${number(s,'cover-gap',0,48)}px 0 0;padding:14px ${pad}px;background:${p.bg};`],['[data-block="caption"] p',`margin:0;color:${p.ink};font-size:${number(s,'caption-size',12,28)}px;line-height:1.7;white-space:pre-wrap;`],
 ['[data-block="cover"]',`display:block;margin:${number(s,'cover-gap',0,48)}px 0 0;padding:0;background:${p.bg};`],['[data-block] img','display:block;width:100%;height:auto;margin:0;max-width:100%;'],
 ['[data-signature]',`display:${s['signature-enabled']===false?'none':'block'};margin:0;padding:24px ${pad}px 32px;text-align:center;background:${p.bg};color:${p.accent};font-size:13px;letter-spacing:2px;`]
 ];
}
