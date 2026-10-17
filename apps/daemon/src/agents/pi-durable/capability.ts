import { execFile } from 'node:child_process';
export interface DurableExecutorCapability {available:boolean;sqlite:boolean;version:string;error?:string}
export function checkDurableExecutor(command:string):Promise<DurableExecutorCapability> {
  const script="const v=process.versions.node.split('.').map(Number);const engine=v[0]>22||(v[0]===22&&(v[1]>19||(v[1]===19)));let sqlite=false;try{await import('node:sqlite');sqlite=true}catch{};console.log(JSON.stringify({available:engine&&sqlite,sqlite,version:process.version,error:engine?'SQLite unavailable':'Pi Durable requires Node >=22.19.0; configure a compatible Node executor.'}))";
  return new Promise((resolve)=>execFile(command,['--input-type=module','-e',script],{timeout:10000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},maxBuffer:65536},(error,stdout)=>{
    if(error) return resolve({available:false,sqlite:false,version:'',error:'The configured Pi Durable executor could not run its capability probe.'});
    try {resolve(JSON.parse(stdout.trim()) as DurableExecutorCapability);}catch{resolve({available:false,sqlite:false,version:'',error:'Invalid Pi Durable executor capability response.'});}
  }));
}
