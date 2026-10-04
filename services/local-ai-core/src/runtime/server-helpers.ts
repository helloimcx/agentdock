import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { LocalAiCoreRoute } from './server-routes.js';
import type { LocalCoreEvent } from '@cc/superai-contracts';
import type { OpenAiChatCompletionChunk } from '@cc/superai-contracts';
import { toLocalCoreErrorInfo, errorInfoToHttpBody } from '../kernel/local-core-errors.js';
import { assertJsonObject, RequestValidationError } from './request-validation.js';

export type RouteHandler = (route: LocalAiCoreRoute, req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

function sendJsonPayload(
  res: ServerResponse,
  statusCode: number,
  payload: string,
  req?: IncomingMessage,
) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const incoming = req || (res as unknown as { req?: IncomingMessage }).req;
  const acceptEncoding = incoming?.headers?.['accept-encoding'];
  const supportsGzip = typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip');

  if (supportsGzip && payload.length > 1024) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(gzipSync(Buffer.from(payload, 'utf-8')));
  } else {
    res.end(payload);
  }
}

export function json<T>(res: ServerResponse, statusCode: number, data: T, ok = true, error?: string, req?: IncomingMessage) {
  sendJsonPayload(res, statusCode, JSON.stringify(ok ? { ok: true, data } : { ok: false, error }), req);
}

export function rawJson<T>(res: ServerResponse, statusCode: number, data: T, req?: IncomingMessage) {
  sendJsonPayload(res, statusCode, JSON.stringify(data), req);
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

export async function readJsonBody(req: IncomingMessage, maxBytes?: number) {
  const body = await readRawBody(req, maxBytes);
  if (!body.length) {
    return {};
  }
  try {
    return assertJsonObject(JSON.parse(Buffer.from(body).toString('utf8')));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw error;
    }
    throw new RequestValidationError('Request body must contain valid JSON.');
  }
}

export async function readRawBody(req: IncomingMessage, maxBytes?: number) {
  const contentLength = Number(req.headers?.['content-length'] || '');
  if (maxBytes !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestValidationError(`Request body exceeds ${maxBytes} bytes.`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (maxBytes !== undefined && total > maxBytes) {
      throw new RequestValidationError(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
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
