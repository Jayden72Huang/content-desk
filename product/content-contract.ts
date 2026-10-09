/** Portable Community contract. Agent output is data, never executable markup. */
export const moduleKinds = ['heading','paragraph','quote','list','image','sources','signature'] as const;
export type ModuleKind = typeof moduleKinds[number];
export interface ContentModule { id:string; kind:ModuleKind; text:string; items:string[]; assetId:string; alt:string; }
export interface TemplateSlot { id:string; kind:ModuleKind; label:string; instruction:string; required:boolean; }
export interface ContentArtifact {
 schemaVersion:1;
 type:'module'|'template'|'article';
 title:string;
 description:string;
 audience:string;
 voice:string;
 modules:ContentModule[];
 slots:TemplateSlot[];
}
const stringSchema = (maxLength:number)=>({type:'string',maxLength});
export const artifactSchema = {
 type:'object',additionalProperties:false,
 required:['schemaVersion','type','title','description','audience','voice','modules','slots'],
 properties:{
  schemaVersion:{type:'integer',enum:[1]},type:{type:'string',enum:['module','template','article']},
  title:{type:'string',minLength:1,maxLength:120},description:stringSchema(4000),audience:stringSchema(1000),voice:stringSchema(1000),
  modules:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['id','kind','text','items','assetId','alt'],properties:{id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},kind:{type:'string',enum:moduleKinds},text:stringSchema(20000),items:{type:'array',maxItems:100,items:stringSchema(4000)},assetId:stringSchema(80),alt:stringSchema(1000)}}},
  slots:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['id','kind','label','instruction','required'],properties:{id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},kind:{type:'string',enum:moduleKinds},label:stringSchema(120),instruction:stringSchema(4000),required:{type:'boolean'}}}}
 }
} as const;
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected an object');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))throw new Error('Unexpected or missing fields');
 return v;
}
function text(value:unknown,max:number):string{if(typeof value!=='string'||value.length>max)throw new Error('Invalid text');return value;}
function id(value:unknown):string{const v=text(value,80);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(v))throw new Error('Invalid ID');return v;}
function kind(value:unknown):ModuleKind{if(!moduleKinds.includes(value as ModuleKind))throw new Error('Unknown module kind');return value as ModuleKind;}
function array(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)throw new Error('Invalid array');return value;}
function unique(values:{id:string}[]){if(new Set(values.map(v=>v.id)).size!==values.length)throw new Error('Duplicate IDs');}
export function parseArtifact(input:unknown):ContentArtifact{
 const v=object(input,['schemaVersion','type','title','description','audience','voice','modules','slots']);
 if(v.schemaVersion!==1||!['module','template','article'].includes(String(v.type)))throw new Error('Unsupported artifact');
 const modules=array(v.modules,100).map(value=>{const m=object(value,['id','kind','text','items','assetId','alt']);return {id:id(m.id),kind:kind(m.kind),text:text(m.text,20000),items:array(m.items,100).map(i=>text(i,4000)),assetId:m.assetId===''?'':id(m.assetId),alt:text(m.alt,1000)};});
 const slots=array(v.slots,50).map(value=>{const s=object(value,['id','kind','label','instruction','required']);if(typeof s.required!=='boolean')throw new Error('Invalid required flag');return {id:id(s.id),kind:kind(s.kind),label:text(s.label,120),instruction:text(s.instruction,4000),required:s.required};});
 unique(modules);unique(slots);
 const title=text(v.title,120);if(!title.trim())throw new Error('Title is required');
 if(v.type==='template'&&(!slots.length||modules.length))throw new Error('Templates need slots and no article content');
 if(v.type==='module'&&(modules.length!==1||slots.length))throw new Error('Module artifact needs exactly one module');
 if(v.type==='article'&&(!modules.length||slots.length))throw new Error('Articles need content modules');
 for(const m of modules){if(m.kind==='image'&&(!m.assetId||!m.alt.trim()))throw new Error('Image requires a known asset reference and alt text');if(m.kind==='list'&&!m.items.length)throw new Error('List cannot be empty');if(!['image','list'].includes(m.kind)&&!m.text.trim())throw new Error('Text module cannot be empty');}
 return {schemaVersion:1,type:v.type as ContentArtifact['type'],title,description:text(v.description,4000),audience:text(v.audience,1000),voice:text(v.voice,1000),modules,slots};
}
