import { realpath, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
async function pathWithin(cwd:string|undefined,path:string) {
  if(!cwd) throw new Error('No workspace is configured.');
  const root=await realpath(cwd);const target=await realpath(resolve(root,path));const rel=relative(root,target);
  if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel)) throw new Error('Read access outside the workspace is denied.');
  return target;
}
export const ReadFile=defineTool({name:'read_file',description:'Read a UTF-8 file inside the configured workspace.',parameters:Type.Object({path:Type.String()}),replay:'safe',execute:async(args,api,context)=>{
  const target=await pathWithin((await api.agent(context)).cwd,args.path);
  if((await stat(target)).size>1024*1024) throw new Error('File exceeds the 1 MiB read limit.');
  return {content:[{type:'text',text:await readFile(target,'utf8')}]};
}});
export const ListFiles=defineTool({name:'list_files',description:'List a directory inside the configured workspace.',parameters:Type.Object({path:Type.String()}),replay:'safe',execute:async(args,api,context)=>{
  const target=await pathWithin((await api.agent(context)).cwd,args.path);
  return {content:[{type:'text',text:(await readdir(target)).slice(0,1000).join('\n')}]};
}});
