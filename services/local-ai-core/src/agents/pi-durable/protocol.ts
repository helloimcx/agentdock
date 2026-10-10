/** Private worker DTOs. No Chord/Pi types escape this boundary. */
export interface DurableConfig {
  agentType: string; workspaceId: string; command: string; args: string[];
  workDir: string; model: string; env: Record<string,string>;
  sandbox?: {enabled?:boolean}; mcpServers?: Array<{enabled?:boolean}>;
}
export interface DurableSubmit {threadId:string;coreSubmissionId:string;coreRunId:string;prompt:string;config:DurableConfig}
export interface DurableWriteRequest {requestId:string;threadId:string;coreSubmissionId:string;coreRunId:string;path:string;content:string}
export type DurableWriteDecision = {ok:true;message:string}|{ok:false;error:string}
export interface DurableBinding {threadId:string;conversationId:number;boundary:string;live:boolean}
export interface DurableResult {conversationId:string;durableSubmissionId:string;status:'done'|'unanswered';answer:string;reason?:string;usage:unknown}
export interface DurableView {threadId:string;coreSubmissionId?:string;conversationId:number;partial:string;tools:Array<{callId:string;name:string;status:string;output?:string}>;usage:unknown}
export interface DurableRequest {id:number;method:string;params:unknown}
export interface DurableResponse {id:number;ok:boolean;result?:unknown;error?:string}
