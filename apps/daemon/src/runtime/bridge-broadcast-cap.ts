import type { DesktopBridgeEvent, DesktopBridgeToolCall } from '@agentdock/contracts';
import { capString } from './bridge-stdout-log.js';

export const BRIDGE_BROADCAST_MAX_CHARS = 65536;

// Renderer SSE payloads carry only a bounded preview of oversized payloads.
// The 2026-11-18 prod death allocated a full JSON copy of a multi-MB
// Terminal result inside broadcast() even with zero SSE clients connected —
// at 90% heap there was no room for that transient string and V8 aborted.
// Full outputs stay available through run-message REST reads; external run
// streams and OpenAI adapters receive the original event untouched.
export function capBridgeEventForBroadcast(
  event: DesktopBridgeEvent,
  maxChars: number = BRIDGE_BROADCAST_MAX_CHARS,
): DesktopBridgeEvent {
  const content = capString(event.content, maxChars);
  const toolCall = event.toolCall ? capToolCall(event.toolCall, maxChars) : event.toolCall;
  if (content === event.content && toolCall === event.toolCall) {
    return event;
  }
  return { ...event, content, toolCall };
}

function capToolCall(toolCall: DesktopBridgeToolCall, maxChars: number): DesktopBridgeToolCall {
  const output = capString(toolCall.output, maxChars);
  const input = typeof toolCall.input === 'string' ? capString(toolCall.input, maxChars) : toolCall.input;
  if (output === toolCall.output && input === toolCall.input) {
    return toolCall;
  }
  return { ...toolCall, output, input };
}
