import fs from 'node:fs';
import {studioShell} from './studio-shell';
import {studioStyle} from './studio-style';
const result=await Bun.build({entrypoints:[import.meta.dir+'/studio.ts'],target:'browser'});
if(!result.success)throw new Error(result.logs.join('\n'));
const script=(await result.outputs[0].text()).replace(/<\/script/gi,'<\\/script');
fs.writeFileSync(import.meta.dir+'/../studio.html',studioShell.replace('/*STYLE*/',()=>studioStyle).replace('/*SCRIPT*/',()=>script));
console.log('Studio built');
