import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { Harness, createRegistry, defineDoc, defineExtension, configure, AssistantEntry, type Conversation, type ConversationView } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import type { ConversationId, SubmissionId } from '@earendil-works/pi-durable';
import { ReadFile,ListFiles } from './read-tools.mjs';
import { createWriteFileTool } from './write-tool.mjs';
import { models,installProvider,boundary } from './providers.mjs';
import type { DurableSubmit,DurableBinding,DurableRequest,DurableView,DurableConfig,DurableWriteDecision,DurableWriteRequest } from './protocol.js';
const context=BACKGROUND_CONTEXT;
const registry=createRegistry();
const Bindings=defineDoc<{threads:Record<string,{conversationId:ConversationId;boundary:string}>}>({kind:'core.bindings',version:1,scope:'session',initial:()=>({threads:{}})});
const Identity=defineDoc<{threadId:string}>({kind:'core.thread',version:1,scope:'conversation',history:'latest',fork:'initial',initial:()=>({threadId:''})});
let harness:Harness|undefined;
let configured=new Set<string>();
const watches=new Map<string,{stop():Promise<unknown>}>();
const activeRuns=new Map<string,{coreSubmissionId:string;coreRunId:string}>();
const pendingWrites=new Map<string,(decision:DurableWriteDecision)=>void>();
const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
function requestWrite(request:DurableWriteRequest):Promise<DurableWriteDecision> {
  return new Promise((resolve)=>{pendingWrites.set(request.requestId,resolve);send({event:'write-request',value:request});});
}
function text(content:unknown):string {return Array.isArray(content)?content.filter((v)=>v&&v.type==='text').map((v)=>v.text).join(''):'';}
async function bindings():Promise<DurableBinding[]> {
  if(!harness) throw new Error('Worker is not initialized.');
  const index=await harness.snapshot(Bindings,context);const result:DurableBinding[]=[];
  const inspected=await harness.inspect(context);const live=new Set(inspected.tasks.map((task)=>String(task.record.conversationId)));
  for(const [threadId,item] of Object.entries(index?.threads || {})) result.push({threadId,...item,live:live.has(String(item.conversationId))});
  return result;
}
async function publish(threadId:string,conversation:Conversation,view:ConversationView) {
  const live=view.docs['pi.live'] as {run?:{inputs:SubmissionId[]};generation?:{message?:{content?:unknown}};tools?:Array<{callId:string;name:string;status:string;output?:string}>}|undefined;
  const first=live?.run?.inputs[0];const submission=first!==undefined?await harness!.submission(first,context):undefined;
  const record=submission?await submission.status(context):undefined;
  const event:DurableView={threadId,conversationId:conversation.id,coreSubmissionId:record?.requestId,partial:text(live?.generation?.message?.content),tools:live?.tools||[],usage:view.docs['pi.usage']};
  send({event:'view',value:event});
}
async function attach(threadId:string,conversation:Conversation) {
  if(watches.has(threadId)) return;
  const watch=await conversation.watch(context);watches.set(threadId,watch);
  await publish(threadId,conversation,watch.value);
  watch.start(async(value)=>publish(threadId,conversation,value));
}
async function configureThread(threadId:string,config:DurableConfig) {
  if(!harness) throw new Error('Worker is not initialized.');
  const ref=installProvider(threadId,config);const fingerprint=boundary(config);
  const extension=defineExtension({name:`agentdock-thread-${createHash('sha256').update(threadId).digest('hex')}`,tools:[ReadFile,ListFiles,createWriteFileTool(threadId,(id)=>activeRuns.get(id),requestWrite)]});
  registry.install(extension);
  const conversationId=await harness.commit(async(tx)=>{
    const index=await tx.doc(Bindings);
    const previous=index.threads[threadId];
    let conversationId=previous?.conversationId;
    if(previous&&previous.boundary!==fingerprint) throw new Error('Recovery blocked: original model, credentials or workspace binding changed.');
    if(!conversationId) conversationId=(await tx.createConversation({ownership:{kind:'ownerless'}})).id;
    await configure(tx,conversationId,{model:ref,cwd:config.workDir,extensions:[extension],instructions:'Use only the provided workspace tools. Read and list are limited to this workspace. write_file can create or replace one UTF-8 text file inside the workspace after explicit one-time user approval for the exact path and content. Never execute shell commands, delete files, or access MCP/sandbox tools.'});
    if(!previous) {
      (await tx.doc(Identity,conversationId)).threadId=threadId;
      index.threads[threadId]={conversationId,boundary:fingerprint};
    }
    return conversationId;
  },context);
  const conversation=await harness.conversation(conversationId as ConversationId,context);
  if(!conversation) throw new Error('Persisted conversation was not found.');
  configured.add(threadId);await attach(threadId,conversation);return conversation;
}
async function ready() {
  const missing=(await bindings()).filter((b)=>b.live&&!configured.has(b.threadId));
  if(missing.length) throw new Error('Global recovery blocked: restore configuration for all live Durable threads before resuming.');
}
async function handle(method:string,params:any):Promise<unknown> {
  if(method==='open') {
    if(harness) throw new Error('Worker already owns a Harness.');
    harness=await Harness.open(await openNodeSqliteStorage(params.file),{models,registry},context);
    return {bindings:await bindings()};
  }
  if(method==='configure') {const conversation=await configureThread(params.threadId,params.config);return {conversationId:conversation.id};}
  if(method==='bindings') return await bindings();
  if(method==='resume') {await ready();harness!.resume();return {resumed:true};}
  if(method==='submit') {
    const input=params as DurableSubmit;const conversation=await configureThread(input.threadId,input.config);
    await ready();activeRuns.set(input.threadId,{coreSubmissionId:input.coreSubmissionId,coreRunId:input.coreRunId});
    try {
      const submission=await conversation.submit({type:'input',content:input.prompt,requestId:input.coreSubmissionId},context);
      const settled=await submission.wait(context);
      const entry=settled.status==='done'&&settled.type==='input'?await conversation.commit((tx)=>tx.entry(AssistantEntry,settled.answer),context):undefined;
      return {conversationId:conversation.id,durableSubmissionId:submission.id,status:settled.status,answer:text(entry?.model?.[0]?.content),reason:settled.status==='unanswered'?settled.reason:undefined,usage:(entry?.model?.[0] as {usage?:unknown}|undefined)?.usage};
    } finally {if(activeRuns.get(input.threadId)?.coreSubmissionId===input.coreSubmissionId) activeRuns.delete(input.threadId);}
  }
  if(method==='resolveWrite') {const input=params as {requestId:string;decision:DurableWriteDecision};const resolve=pendingWrites.get(input.requestId);if(!resolve) throw new Error('Workspace write request is stale or unknown.');pendingWrites.delete(input.requestId);resolve(input.decision);return {resolved:true};}
  if(method==='cancel') {const index=await harness!.snapshot(Bindings,context);const id=index?.threads[params.threadId]?.conversationId;if(id) await (await harness!.conversation(id,context))?.abort(context);return {cancelled:!!id};}
  if(method==='close') {for(const watch of watches.values()) await watch.stop();await harness?.close(context);harness=undefined;return {closed:true};}
  throw new Error('Unknown worker operation.');
}
process.on('disconnect',()=>{process.exit(0);});
const lines=createInterface({input:process.stdin});
lines.on('line',(line)=>{
  if(line.length>4*1024*1024) {process.exit(1);return;}
  let request:DurableRequest;
  try {request=JSON.parse(line) as DurableRequest;}catch {process.exit(1);return;}
  void handle(request.method,request.params).then((result)=>send({id:request.id,ok:true,result}),()=>send({id:request.id,ok:false,error:'Pi Durable operation failed or recovery configuration is incomplete.'}));
});
lines.on('close',()=>{void handle('close',{}).finally(()=>process.exit(0));});
