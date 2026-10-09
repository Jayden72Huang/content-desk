import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { templateSettings, type Settings } from './article-format';

export interface SnapshotInput { issueId: string; seriesId: string; title: string; html: string; cover: string; settings: Record<string, string | boolean>; digest?: string; }
export interface Snapshot extends SnapshotInput { revision: string; savedAt: string; imageCount: number; }
export interface Receipt { revision: string; stage: string; status: 'working' | 'uncertain' | 'created' | 'verified' | 'failed'; mediaId?: string; error?: string; updatedAt: string; targetMediaId?: string; }
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export function safeImage(src: string): boolean {
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)) return true;
  try { const u = new URL(src); return u.protocol === 'https:' && (u.hostname === 'mmbiz.qpic.cn' || u.hostname.endsWith('.qpic.cn')) && !u.username && !u.password; } catch { return false; }
}
export function cleanHtml(html: string): string {
  if (typeof html !== 'string' || html.length > 16 * 1024 * 1024) throw new Error('图文内容无效或超过 16MB');
  const $ = load(html, null, false);
  $('script,style,iframe,object,embed,form,input,button,textarea,select,svg,link,meta,base,video,audio').remove();
  const tags = new Set(['section','article','div','p','span','strong','b','i','em','u','s','br','hr','img','h1','h2','h3','h4','blockquote','ul','ol','li','a','pre','code','table','tbody','thead','tr','td','th','figure','figcaption','sup','sub']);
  $('*').each((_, el) => {
    if (!('tagName' in el) || !('attribs' in el)) return;
    const node = $(el);
    if (!tags.has(el.tagName)) { node.replaceWith(node.contents()); return; }
    for (const attr of Object.keys(el.attribs)) if (!['style','src','href','alt','data-block','data-content-header','data-signature','data-sources','data-source'].includes(attr)) node.removeAttr(attr);
    const style = node.attr('style') || '';
    if (/url\s*\(|expression|@import|javascript|behavior|\\/i.test(style)) node.removeAttr('style');
    const href = node.attr('href'); if (href && !/^https:\/\//i.test(href)) node.removeAttr('href');
  });
  if ($('[data-content-header="1"]').length !== 1 || !$('[data-block="cover"] img').length || !$('[data-block="logo"] img').length || !$('[data-block="caption"]').length) throw new Error('缺少 Logo、封面或标语模块，请重新加载完整图文');
  if (!$('h1').text().trim() || $('img').length > 30) throw new Error('正文标题缺失或图片超过 30 张');
  $('img').each((_, el) => { if (!safeImage($(el).attr('src') || '')) throw new Error('图片必须内嵌保存或来自微信 CDN，请先导入图片'); });
  return $.html();
}
export class LocalStore {
  constructor(public readonly dir: string) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  private file(id: string, suffix: string) { if (!validId(id)) throw new Error('无效的版本编号'); return path.join(this.dir, id + suffix); }
  atomic(file: string, data: unknown) { const tmp = file + '.' + randomUUID() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(tmp, file); }
  save(input: SnapshotInput): Snapshot {
    if (!validId(input.issueId) || !validId(input.seriesId)) throw new Error('系列或文章编号无效');
    if (typeof input.title !== 'string' || !input.title.trim() || [...input.title].length > 64) throw new Error('标题需为 1–64 个字符');
    if (typeof input.cover !== 'string' || !input.cover.startsWith('data:') || !safeImage(input.cover) || input.cover.length > 12 * 1024 * 1024) throw new Error('封面未完整保存');
    if (!input.settings || typeof input.settings !== 'object' || Object.keys(input.settings).length > 50 || Object.values(input.settings).some(v => !['string','boolean'].includes(typeof v) || String(v).length > 500)) throw new Error('排版设置无效');
    if(input.digest!==undefined&&(typeof input.digest!=='string'||[...input.digest].length>120))throw new Error('摘要不能超过 120 字');
    const html = cleanHtml(input.html);
    const data: SnapshotInput = { issueId: input.issueId, seriesId: input.seriesId, title: input.title.trim(), html, cover: input.cover, settings: Object.fromEntries(Object.entries(input.settings).sort(([a], [b]) => a.localeCompare(b))) };
    if(input.digest!==undefined)data.digest=input.digest;
    const revision = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const file = this.file(revision, '.snapshot.json');
    if (fs.existsSync(file)) return this.get(revision);
    const snapshot: Snapshot = { ...data, revision, savedAt: new Date().toISOString(), imageCount: load(html)('img').length };
    this.atomic(file, snapshot); return snapshot;
  }
  get(revision: string): Snapshot { return JSON.parse(fs.readFileSync(this.file(revision, '.snapshot.json'), 'utf8')); }
  list() { return fs.readdirSync(this.dir).filter(f => f.endsWith('.snapshot.json')).map(f => {
    const s = this.get(f.replace('.snapshot.json', ''));
    return { revision: s.revision, issueId: s.issueId, seriesId: s.seriesId, title: s.title, savedAt: s.savedAt, imageCount: s.imageCount, receipt: this.receipt(s.revision), review: this.review(s.revision) };
  }).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); }
  receipt(revision: string): Receipt | null { const file = this.file(revision, '.receipt.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
  isCurrentReceipt(revision:string):boolean {const r=this.receipt(revision);if(r?.status!=='verified'||!r.mediaId)return false;return !this.list().some(s=>s.revision!==revision&&s.receipt?.status==='verified'&&s.receipt.mediaId===r.mediaId&&s.receipt.updatedAt>r.updatedAt);}
  record(revision: string, value: Omit<Receipt, 'revision' | 'updatedAt'>): Receipt { const receipt = { ...value, revision, updatedAt: new Date().toISOString() }; this.atomic(this.file(revision, '.receipt.json'), receipt); return receipt; }
  review(revision:string): {status:'pending'|'reviewed'|'published';updatedAt:string}|null { const file=this.file(revision,'.review.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null; }
  reviewVersion(revision:string,status:unknown){this.get(revision);if(!['pending','reviewed','published'].includes(String(status)))throw new Error('无效审查状态');const review={status,updatedAt:new Date().toISOString()};this.atomic(this.file(revision,'.review.json'),review);return review;}
  template(seriesId:string){const file=this.file(seriesId,'.template.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
  saveTemplate(input:{seriesId:string;settings:Settings;logo:string;sample?:{title:string;body:string}}){
    if(!validId(input.seriesId)||!this.catalog().series.some(s=>s.id===input.seriesId))throw new Error('系列不存在');
    if(!input.settings||typeof input.settings!=='object'||JSON.stringify(input.settings).length>12000)throw new Error('模板设置无效');
    if(typeof input.logo!=='string'||!input.logo.startsWith('data:image/')||!safeImage(input.logo)||input.logo.length>4000000)throw new Error('Logo 格式无效或过大');
    if(input.sample&&(typeof input.sample.title!=='string'||!input.sample.title.trim()||input.sample.title.length>64||typeof input.sample.body!=='string'||!input.sample.body.trim()||input.sample.body.length>20000))throw new Error('模板示例文案无效');
    const data={seriesId:input.seriesId,settings:templateSettings(input.settings),logo:input.logo,...(input.sample?{sample:{title:input.sample.title,body:input.sample.body}}:{})};
    const revision=createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const result={...data,revision,savedAt:new Date().toISOString()};
    this.atomic(this.file(revision,'.template-version.json'),result);this.atomic(this.file(input.seriesId,'.template.json'),result);return result;
  }
  catalog(): { series: Array<{id: string; name: string; layout: string; settings?: Record<string, string | boolean>;createdAt?:string;description?:string}> } { const f=path.join(this.dir,'catalog.json'); return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{series:[]}; }
  saveCatalog(value: ReturnType<LocalStore['catalog']>) {
    if (!Array.isArray(value.series) || new Set(value.series.map(s=>s.id)).size!==value.series.length || value.series.some(s=>!validId(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||typeof s.layout!=='string'||s.layout.length>80)) throw new Error('系列数据无效');
    if(JSON.stringify(value).length>10_000_000)throw new Error('系列设置过大');this.atomic(path.join(this.dir,'catalog.json'),value);
  }
}
