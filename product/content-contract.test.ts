import {test,expect} from 'bun:test';
import {parseArtifact} from './content-contract';
const paragraph={id:'intro',kind:'paragraph',text:'可编辑的内容',items:[],assetId:'',alt:''};
const base={schemaVersion:1,type:'module',title:'导语',description:'',audience:'内容创作者',voice:'简洁',modules:[paragraph],slots:[]};
test('module, content template and article remain distinct portable artifacts',()=>{
 expect(parseArtifact(base).modules[0].text).toBe('可编辑的内容');
 const template={...base,type:'template',modules:[],slots:[{id:'intro',kind:'paragraph',label:'导语',instruction:'说明读者为什么需要了解这个主题',required:true}]};
 expect(parseArtifact(template).slots).toHaveLength(1);
 expect(()=>parseArtifact({...template,modules:[paragraph]})).toThrow();
 expect(parseArtifact({...base,type:'article'}).modules).toHaveLength(1);
});
test('reject unknown code-bearing fields, unsupported versions and duplicate module IDs',()=>{
 expect(()=>parseArtifact({...base,script:'run()'})).toThrow();
 expect(()=>parseArtifact({...base,schemaVersion:2})).toThrow();
 expect(()=>parseArtifact({...base,type:'article',modules:[paragraph,paragraph]})).toThrow();
 expect(()=>parseArtifact({...base,modules:[{...paragraph,kind:'javascript'}]})).toThrow();
});
test('asset references cannot become filesystem paths or network fetches',()=>{
 for(const assetId of ['../secrets','/etc/passwd','https://example.com/a.png'])expect(()=>parseArtifact({...base,modules:[{...paragraph,kind:'image',assetId,alt:'封面'}]})).toThrow();
 expect(parseArtifact({...base,modules:[{...paragraph,kind:'image',assetId:'asset-cover',alt:'封面'}]}).modules[0].assetId).toBe('asset-cover');
});
test('empty and oversized output is rejected before import',()=>{
 expect(()=>parseArtifact({...base,title:' '})).toThrow();
 expect(()=>parseArtifact({...base,modules:[]})).toThrow();
 expect(()=>parseArtifact({...base,modules:[{...paragraph,text:'x'.repeat(20001)}]})).toThrow();
});
