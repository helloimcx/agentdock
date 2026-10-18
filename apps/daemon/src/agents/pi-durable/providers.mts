import { createModels, createProvider, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { createHash } from 'node:crypto';
import type { DurableConfig } from './protocol.js';
export const models=createModels();
export function boundary(config:DurableConfig) {
  return createHash('sha256').update(JSON.stringify({workspaceId:config.workspaceId,cwd:config.workDir,model:config.model,baseUrl:config.env.OPENAI_BASE_URL||'',apiKeyHash:createHash('sha256').update(config.env.OPENAI_API_KEY||'').digest('hex')})).digest('hex');
}
export function installProvider(threadId:string,config:DurableConfig) {
  if(config.agentType!=='pi-durable'||config.sandbox?.enabled||config.mcpServers?.some((s)=>s.enabled!==false)) throw new Error('Pi Durable supports local text, workspace reads and approval-gated text writes; shell, MCP and sandbox are unavailable.');
  const baseUrl=config.env.OPENAI_BASE_URL||'https://api.openai.com/v1';
  const key=config.env.OPENAI_API_KEY;
  if(!key||!config.model||!config.workDir) throw new Error('Pi Durable recovery needs a configured OpenAI-compatible model, credentials and workspace.');
  if(!/^https?:\/\//.test(baseUrl)) throw new Error('Pi Durable requires an HTTP(S) OpenAI-compatible endpoint.');
  const provider=`core-${createHash('sha256').update(threadId).digest('hex')}`;
  const model:Model<'openai-completions'>={id:config.model,name:config.model,api:'openai-completions',provider,baseUrl,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:8192,compat:{supportsDeveloperRole:false,supportsReasoningEffort:false}};
  models.setProvider(createProvider({id:provider,baseUrl,auth:{apiKey:{name:'Core-managed credential',resolve:async()=>({auth:{apiKey:key}})}},models:[model],api:openAICompletionsApi()}));
  return {provider,modelId:config.model};
}
