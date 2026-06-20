import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LocalAiCoreRoute } from './server-routes.js';
import type { LocalCoreEvent } from '@cc/superai-contracts';
import type { OpenAiChatCompletionChunk } from '@cc/superai-contracts';
import { toLocalCoreErrorInfo, errorInfoToHttpBody } from '../kernel/local-core-errors.js';

export type RouteHandler = (route: LocalAiCoreRoute, req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

export function json<T>(res: ServerResponse, statusCode: number, data: T, ok = true, error?: string) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(ok ? { ok: true, data } : { ok: false, error }));
}

export function rawJson<T>(res: ServerResponse, statusCode: number, data: T) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function openAiJsonError(res: ServerResponse, statusCode: number, message: string, code = 'invalid_request_error') {
  rawJson(res, statusCode, {
    error: {
      message,
      type: code,
      code,
    },
  });
}

export function jsonError(res: ServerResponse, statusCode: number, error: unknown) {
  const info = toLocalCoreErrorInfo(error);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(errorInfoToHttpBody(info)));
}

export async function readJsonBody(req: IncomingMessage) {
  const body = await readRawBody(req);
  if (!body.length) {
    return {};
  }
  return JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
}

export async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (origin === 'null' || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function createSseEvent(name: LocalCoreEvent['type'], payload: LocalCoreEvent) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function createOpenAiSseData(payload: OpenAiChatCompletionChunk) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function createOpenAiDone() {
  return 'data: [DONE]\n\n';
}

export function sanitizeOpenAiId(value: string) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120) || 'run';
}

export function diffAccumulatedText(previous: string, next: string) {
  if (!next) {
    return '';
  }
  if (!previous) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  if (previous === next) {
    return '';
  }
  return next;
}

export function isTerminalAgentTaskStatus(status?: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
