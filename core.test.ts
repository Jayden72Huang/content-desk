import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalStore, cleanHtml, type SnapshotInput } from './store';
import { DraftPublisher, verifyDraft, createCredentialReader } from './wechat';
import { assembleArticle } from './assemble-automation-payload';

const png=await sharp({create:{width:8,height:8,channels:3,background:'#ffdd00'}}).png().toBuffer();
const data='data:image/png;base64,'+png.toString('base64');
function input():SnapshotInput{return {issueId:'issue-test',seriesId:'series-test',title:'测试文章',cover:data,settings:{theme:'solid','solid-color':'#101113'},html:'<section style="background-color:#101113"><section data-content-header="1"><section data-block="logo"><img src="'+data+'"></section><section data-block="cover"><img src="'+data+'"></section><section data-block="caption"><p>当前标语</p></section></section><article><section><h1>测试文章</h1><p>正文内容</p></section></article><section><strong>尾部签名</strong></section></section>'};}
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jayden-unit-'));return {store:new LocalStore(dir),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};}
function fakeWx(options:{failGet?:boolean;timeoutAdd?:boolean;dropHeader?:boolean;timeoutUpdate?:boolean}={}){
  const calls:string[]=[];let content='',title='',thumb='';let failGet=options.failGet;
  const transport=(async(url:string|URL|Request,init?:RequestInit)=>{
    const route=new URL(String(url)).pathname.split('/').slice(-2).join('/');calls.push(route);
    let response:Record<string,unknown>={};
    if(route.endsWith('stable_token'))response={access_token:'test-only-token'};
    else if(route==='media/uploadimg')response={url:'https://mmbiz.qpic.cn/test/image'};
    else if(route==='material/add_material')response={media_id:'thumb-current'};
    else if(route==='draft/update'){
      const payload=JSON.parse(String(init?.body));expect(payload.media_id).toBe('draft-current-verified');expect(payload.index).toBe(0);
      const item=payload.articles;content=item.content;title=item.title;thumb=item.thumb_media_id;
      if(options.timeoutUpdate)throw new Error('update response lost');
      response={errcode:0};
    }else if(route==='draft/add'){
      if(options.timeoutAdd)throw new Error('lost response');
      const item=JSON.parse(String(init?.body)).articles[0];content=item.content;title=item.title;thumb=item.thumb_media_id;
      response={media_id:'draft-current-verified'};
    }else if(route==='draft/get'){
      if(failGet){failGet=false;throw new Error('read failed');}
      response={news_item:[{title,content:options.dropHeader?'<h1>测试文章</h1><p>正文内容</p>':content,thumb_media_id:thumb}]};
    }else throw new Error('UNEXPECTED route '+route);
    return new Response(JSON.stringify(response),{status:200});
  }) as typeof fetch;
  return {transport,calls,content:()=>content};
}
test('immutable disk snapshots restore header, settings and image bytes after restart',()=>{const {store,cleanup}=fixture();try{const s=store.save(input());expect(s.imageCount).toBe(2);expect(new LocalStore(store.dir).get(s.revision)).toEqual(s);expect(store.save(input()).revision).toBe(s.revision);const next=input();next.html=next.html.replace('当前标语','修改后的标语');expect(store.save(next).revision).not.toBe(s.revision);expect(store.list()).toHaveLength(2);}finally{cleanup();}});
test('rejects missing header instead of silently sending original markdown',()=>{expect(()=>cleanHtml('<h1>仅正文</h1>')).toThrow('缺少');});
test('removes executable HTML and denies local/network image sources',()=>{const sample=input();expect(cleanHtml(sample.html+'<script>alert(1)</script><p onclick="evil()">安全</p>')).not.toContain('onclick');expect(cleanHtml(sample.html+'<script>alert(1)</script>')).not.toContain('<script');expect(()=>cleanHtml(sample.html.replace(data,'http://127.0.0.1/secret'))).toThrow('图片必须');});
test('rejects traversal IDs and invalid titles',()=>{const {store,cleanup}=fixture();try{expect(()=>store.save({...input(),issueId:'../../secret'})).toThrow();expect(()=>store.save({...input(),title:''})).toThrow();}finally{cleanup();}});
test('draft contains logo cover caption body signature; current cover is thumb; repeated push dedupes',async()=>{const {store,cleanup}=fixture();try{const snapshot=store.save(input()),wx=fakeWx(),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);const r=await p.push(snapshot.revision);expect(r.status).toBe('verified');expect(wx.content()).toContain('当前标语');expect(wx.content()).toContain('尾部签名');expect(wx.content()).not.toContain('data:image');expect(wx.calls.filter(x=>x==='media/uploadimg')).toHaveLength(1);await p.push(snapshot.revision);expect(wx.calls.filter(x=>x==='draft/add')).toHaveLength(1);expect(wx.calls.every(x=>!x.includes('publish'))).toBe(true);}finally{cleanup();}});
test('readback failure keeps media_id and next push only rereads, never creates duplicate',async()=>{const {store,cleanup}=fixture();try{const s=store.save(input()),wx=fakeWx({failGet:true}),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);await expect(p.push(s.revision)).rejects.toThrow();expect(store.receipt(s.revision)?.status).toBe('created');await p.push(s.revision);expect(wx.calls.filter(x=>x==='draft/add')).toHaveLength(1);expect(store.receipt(s.revision)?.status).toBe('verified');}finally{cleanup();}});
test('uncertain add response blocks retry including after process restart',async()=>{const {store,cleanup}=fixture();try{const s=store.save(input()),wx=fakeWx({timeoutAdd:true}),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);await expect(p.push(s.revision)).rejects.toThrow();expect(store.receipt(s.revision)?.status).toBe('uncertain');await expect(new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport).push(s.revision)).rejects.toThrow('结果未确认');expect(wx.calls.filter(x=>x==='draft/add')).toHaveLength(1);}finally{cleanup();}});
test('missing header in remote readback is not success',async()=>{const {store,cleanup}=fixture();try{const s=store.save(input()),wx=fakeWx({dropHeader:true}),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);await expect(p.push(s.revision)).rejects.toThrow('不一致');expect(store.receipt(s.revision)?.status).toBe('created');}finally{cleanup();}});
test('invalid credential stage cannot upload or create a draft',async()=>{const {store,cleanup}=fixture();try{const s=store.save(input()),wx=fakeWx(),p=new DraftPublisher(store,async()=>{throw new Error('配置缺失');},wx.transport);await expect(p.push(s.revision)).rejects.toThrow('配置缺失');expect(wx.calls).toHaveLength(0);}finally{cleanup();}});
test('title or cover mismatch is rejected in readback',()=>{expect(()=>verifyDraft('<p>a</p>','<p>a</p>','A','B','t','t')).toThrow();expect(()=>verifyDraft('<p>a</p>','<p>a</p>','A','A','t','wrong')).toThrow();});
test('catalog persists independent series templates and rejects duplicate IDs',()=>{const {store,cleanup}=fixture();try{const series=[{id:'one',name:'第一系列',layout:'模板一',settings:{theme:'solid'}},{id:'two',name:'第二系列',layout:'模板二',settings:{theme:'deep'}}];store.saveCatalog({series});expect(new LocalStore(store.dir).catalog().series).toEqual(series);expect(()=>store.saveCatalog({series:[series[0],series[0]]})).toThrow();}finally{cleanup();}});
test('snapshot export and import preserves complete content and revision',()=>{const a=fixture(),b=fixture();try{const saved=a.store.save(input());const restored=b.store.save(JSON.parse(JSON.stringify(saved)));expect(restored.revision).toBe(saved.revision);expect(restored.html).toBe(saved.html);expect(restored.settings).toEqual(saved.settings);}finally{a.cleanup();b.cleanup();}});

test('editing a synced issue updates its draft and reads back without creating a second draft',async()=>{const {store,cleanup}=fixture();try{const wx=fakeWx(),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);const first=store.save(input());await p.push(first.revision);const next=input();next.html=next.html.replace('正文内容','修改过的正文内容');const s=store.save(next);await p.push(s.revision,'draft-current-verified');expect(wx.calls.filter(c=>c==='draft/add')).toHaveLength(1);expect(wx.calls.filter(c=>c==='draft/update')).toHaveLength(1);expect(store.receipt(s.revision)?.status).toBe('verified');}finally{cleanup();}});
test('lost update response retries only readback, not update or add',async()=>{const {store,cleanup}=fixture();try{const wx=fakeWx({timeoutUpdate:true}),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);const s=store.save(input());await expect(p.push(s.revision,'draft-current-verified')).rejects.toThrow();expect(store.receipt(s.revision)?.mediaId).toBe('draft-current-verified');await p.push(s.revision);expect(wx.calls.filter(c=>c==='draft/update')).toHaveLength(1);expect(wx.calls.filter(c=>c==='draft/add')).toHaveLength(0);expect(store.receipt(s.revision)?.status).toBe('verified');}finally{cleanup();}});
test('an uncertain earlier version prevents a new revision from duplicating the draft',async()=>{const {store,cleanup}=fixture();try{const first=store.save(input());store.record(first.revision,{stage:'draft/add',status:'uncertain'});const next=input();next.html=next.html.replace('正文内容','新正文内容');const s=store.save(next),wx=fakeWx();await expect(new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport).push(s.revision)).rejects.toThrow('未确认');expect(wx.calls).toHaveLength(0);}finally{cleanup();}});
test('review applies to one immutable version and template excludes article-specific sources',()=>{const {store,cleanup}=fixture();try{const s=store.save(input());store.reviewVersion(s.revision,'reviewed');const next=input();next.html=next.html.replace('正文内容','新的正文内容');expect(store.review(store.save(next).revision)).toBeNull();store.saveCatalog({series:[{id:'series-test',name:'测试系列',layout:'测试模板'}]});const t=store.saveTemplate({seriesId:'series-test',logo:data,settings:{theme:'nebula','sources-view':'旧文章引用','body-size':'18'}});expect(t.settings['sources-view']).toBeUndefined();expect(t.settings['body-size']).toBe('18');expect(new LocalStore(store.dir).template('series-test').revision).toBe(t.revision);}finally{cleanup();}});

test('automation uses current template, correct article cover and sources without nesting old headers',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jayden-assembly-'));try{fs.writeFileSync(path.join(dir,'article.jpg'),png);fs.writeFileSync(path.join(dir,'wechat-rendered.html'),'<section><section data-content-header="1"><p>旧开头</p></section><h1>输入标题</h1><p>本期的正文</p><img src="article.jpg"><blockquote>事实依据：本期官方来源 2026-10-08</blockquote></section>');const result=assembleArticle({articleDir:dir,template:{seriesId:'series-test',revision:'template-v2',logo:data,settings:{theme:'nebula','body-size':'18','sources-view':'旧文章不应复制的来源'}},issueId:'article-new',title:'本期标题'});expect(result.html).toContain('本期标题');expect(result.html).toContain('本期官方来源');expect(result.html).not.toContain('旧文章不应复制的来源');expect(result.html).not.toContain('旧开头');expect(result.html.match(/data-content-header/g)).toHaveLength(1);expect(result.html).toContain('font-size:18px');expect(result.settings['template-version']).toBe('template-v2');expect(result.seriesId).toBe('series-test');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('placeholder content stops before credentials and network',async()=>{const {store,cleanup}=fixture();try{const x=input();x.html=x.html.replace('正文内容','点击这里开始撰写正文。');const snapshot=store.save(x),wx=fakeWx();await expect(new DraftPublisher(store,async()=>{throw new Error('should not read credentials');},wx.transport).push(snapshot.revision)).rejects.toThrow('占位');expect(wx.calls).toHaveLength(0);}finally{cleanup();}});

test('restoring an earlier synced revision updates instead of trusting its stale receipt',async()=>{const {store,cleanup}=fixture();try{const wx=fakeWx(),p=new DraftPublisher(store,async()=>({appid:'fake',secret:'fake'}),wx.transport);const first=store.save(input());await p.push(first.revision);const r=store.receipt(first.revision)!;store.atomic(store.dir+'/'+first.revision+'.receipt.json',{...r,updatedAt:'2020-01-01T00:00:00.000Z'});const next=input();next.html=next.html.replace('正文内容','更新后的正文内容');const second=store.save(next);await p.push(second.revision,r.mediaId);expect(store.isCurrentReceipt(first.revision)).toBe(false);await p.push(first.revision,r.mediaId);expect(wx.calls.filter(c=>c==='draft/update')).toHaveLength(2);expect(wx.content()).not.toContain('更新后的正文内容');}finally{cleanup();}});


test('credential reads coalesce, expire and never retain failed or cross-file values',async()=>{
 let time=0,calls=0,fail=false,secret='first';
 const reader=createCredentialReader(async file=>{calls++;await Promise.resolve();if(fail)throw new Error('read blocked');return JSON.stringify({appid:file,appsecret:secret});},()=>time);
 const pair=await Promise.all([reader('a'),reader('a')]);expect(calls).toBe(1);expect(pair[0].appid).toBe('a');
 pair[0].secret='mutation';expect((await reader('a')).secret).toBe('first');
 expect((await reader('b')).appid).toBe('b');expect(calls).toBe(2);
 time=60001;fail=true;await expect(reader('a')).rejects.toThrow('read blocked');
 fail=false;secret='rotated';expect((await reader('a')).secret).toBe('rotated');expect(calls).toBe(4);
});


test('template sample stays independent, latest settings replace template without changing articles',()=>{
 const {store,cleanup}=fixture();try{
 store.saveCatalog({series:[{id:'series-test',name:'示例系列',layout:'排版'}]});const article=store.save(input());
 const first=store.saveTemplate({seriesId:'series-test',logo:data,settings:{'body-size':'16'},sample:{title:'模板标题',body:'独立示例文案'}});
 const next=store.saveTemplate({seriesId:'series-test',logo:data,settings:{'body-size':'20'},sample:{title:'新版模板',body:'新版示例'}});
 expect(next.revision).not.toBe(first.revision);expect(new LocalStore(store.dir).template('series-test').sample.title).toBe('新版模板');
 expect(store.template('series-test').settings['body-size']).toBe('20');expect(store.get(article.revision).html).toBe(article.html);
 expect(store.list()).toHaveLength(1);expect(()=>store.saveTemplate({seriesId:'series-test',logo:data,settings:{},sample:{title:'',body:'测试'}})).toThrow();
 }finally{cleanup();}
});
