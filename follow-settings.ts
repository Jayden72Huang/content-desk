/** Editor-only tracking. Never writes inline styles or changes article content. */
export function installFollowSettings(root:HTMLElement,sourceNode:()=>HTMLElement|null){
 const canvas=document.getElementById('canvas')!;
 const inspector=document.querySelector<HTMLElement>('.inspector')!;
 const toggle=document.getElementById('follow-settings') as HTMLInputElement;
 const state=document.getElementById('follow-state')!;
 const nav=document.getElementById('module-nav')!;
 const groups=Array.from(inspector.querySelectorAll<HTMLDetailsElement>('[data-settings-section]'));
 const definitions=[['logo','Logo'],['cover','封面'],['caption','标语'],['title','标题'],['body','正文'],['sources','引用'],['signature','签名']] as const;
 let active='',manualUntil=0,frame=0;
 toggle.checked=localStorage.getItem('desk-follow-settings')!=='off';
 function target(key:string):HTMLElement|null{
   if(key==='layout')return root.querySelector('[data-content-header]');
   if(['logo','cover','caption'].includes(key))return root.querySelector('[data-block="'+key+'"]');
   if(key==='title')return root.querySelector('article h1');
   if(key==='body')return root.querySelector('article>section');
   if(key==='sources')return sourceNode();
   if(key==='signature')return root.querySelector('[data-signature]');
   return null;
 }
 function name(key:string){return definitions.find(([id])=>id===key)?.[1]||'布局组合';}
 function paint(key:string){
   nav.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.module===key)));
   root.querySelectorAll('.follow-highlight').forEach(el=>el.classList.remove('follow-highlight'));
   target(key)?.classList.add('follow-highlight');
   state.textContent=(toggle.checked?'跟随中：':'手动定位：')+name(key)+' → 对应设置';
 }
 function activate(key:string,scrollPanel:boolean){
   const group=groups.find(g=>g.dataset.settingsSection===key);if(!group)return;
   const same=key===active;
   const focus=document.activeElement;
   // Do not close or scroll away from a field that the user is editing.
   const editing=!!focus&&inspector.contains(focus)&&focus.matches('input:not([type=checkbox]),textarea,select');
   if(editing&&scrollPanel){state.textContent='正在编辑设置 · 跟随暂缓';return;}
   active=key;groups.forEach(g=>{g.classList.toggle('follow-active',g===group);if(toggle.checked||g===group)g.open=g===group;});
   paint(key);
   if(scrollPanel&&!same){const top=group.getBoundingClientRect().top-inspector.getBoundingClientRect().top+inspector.scrollTop-(inspector.querySelector<HTMLElement>('.inspector-sticky')?.offsetHeight||110)-12;inspector.scrollTo({top:Math.max(0,top),behavior:'smooth'});}
 }
 function controlsHeight(){return document.querySelector<HTMLElement>('.article-controls')?.offsetHeight||0;}
 function jump(key:string){const el=target(key);if(!el||!el.getClientRects().length)return;manualUntil=performance.now()+750;activate(key,true);window.scrollTo({top:Math.max(0,window.scrollY+el.getBoundingClientRect().top-controlsHeight()-24),behavior:'smooth'});}
 function detect(){frame=0;if(!toggle.checked||performance.now()<manualUntil||!root.children.length)return;
   const base=Math.min(window.innerHeight-40,controlsHeight()+80);
   const remaining=Math.max(0,document.documentElement.scrollHeight-window.innerHeight-window.scrollY);
   // Near the page end, move the reading line downward so short final modules
   // remain reachable without adding a blank viewport after the article.
   const progress=Math.max(0,1-remaining/(window.innerHeight*.7));
   const line=base+Math.max(0,window.innerHeight-55-base)*progress;
   const candidates=definitions.map(([key])=>({key,el:target(key)})).filter((v):v is {key:typeof definitions[number][0];el:HTMLElement}=>!!v.el&&v.el.getClientRects().length>0);
   // Specific modules take precedence over the enclosing body section.
   let hit=candidates.filter(v=>v.key!=='body').find(v=>{const r=v.el.getBoundingClientRect();return r.top<=line&&r.bottom>line;});
   if(!hit){const body=candidates.find(v=>v.key==='body');if(body){const r=body.el.getBoundingClientRect();if(r.top<=line&&r.bottom>line)hit=body;}}
   if(!hit){hit=candidates.reduce<typeof candidates[number]|undefined>((best,v)=>!best||Math.abs(v.el.getBoundingClientRect().top-line)<Math.abs(best.el.getBoundingClientRect().top-line)?v:best,undefined);}
   if(hit)activate(hit.key,true);
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(detect);}
 function refresh(){nav.replaceChildren();definitions.forEach(([key,label])=>{const el=target(key);if(!el||!el.getClientRects().length)return;const button=document.createElement('button');button.type='button';button.dataset.module=key;button.textContent=label;button.setAttribute('aria-label','定位到'+label+'及对应设置');button.setAttribute('aria-pressed',String(key===active));button.onclick=()=>jump(key);nav.append(button);});active='';schedule();}
 toggle.onchange=()=>{localStorage.setItem('desk-follow-settings',toggle.checked?'on':'off');if(toggle.checked){manualUntil=0;schedule();}else{state.textContent='手动模式 · 点击模块或设置定位';groups.forEach(g=>g.classList.remove('follow-active'));root.querySelectorAll('.follow-highlight').forEach(el=>el.classList.remove('follow-highlight'));}};
 groups.forEach(group=>group.querySelector('summary')!.addEventListener('click',e=>{const key=group.dataset.settingsSection!;if(key==='export')return;if(!target(key))return;e.preventDefault();jump(key);}));
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule);
 root.addEventListener('load',schedule,true);
 inspector.addEventListener('focusout',()=>setTimeout(schedule,0));
 new ResizeObserver(schedule).observe(canvas);
 // React to article switches and source blocks added through the editor, not tracking classes.
 new MutationObserver(()=>{refresh();}).observe(root,{childList:true,subtree:true});
 refresh();
 return {refresh,jump};
}
