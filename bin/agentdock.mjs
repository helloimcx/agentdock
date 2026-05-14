#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrotliCompress, createGzip } from 'node:zlib';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(packageRoot, 'dist', 'renderer');
const coreEntry = path.join(packageRoot, 'dist-electron', 'services', 'local-ai-core', 'src', 'runtime', 'standalone.js');
const defaultHost = '127.0.0.1';
const defaultWebPort = 14173;
const defaultCoreOrigin = 'http://127.0.0.1:9831';

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [rawKey, rawValue] = arg.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (typeof rawValue === 'string') {
      flags[key] = rawValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
      continue;
    }
    flags[key] = 'true';
  }
  return { command: positional[0] || 'help', flags };
}

function readFlag(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}

function readPort(flags, name, fallback) {
  const value = Number(readFlag(flags, name, fallback));
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid --${name}: ${readFlag(flags, name, fallback)}`);
  }
  return value;
}

function printHelp() {
  console.log(`AgentDock

Usage:
  agentdock core
  agentdock web [--host 127.0.0.1] [--port 14173] [--core-origin http://127.0.0.1:9831]
  agentdock serve [--host 127.0.0.1] [--port 14173] [--core-origin http://127.0.0.1:9831]

Examples:
  agentdock serve
  agentdock serve --host 0.0.0.0
  agentdock web --port 14173
`);
}

function ensureBuildOutput({ requireRenderer = true, requireCore = true } = {}) {
  if (requireRenderer && !existsSync(rendererRoot)) {
    throw new Error(`Missing renderer build output: ${rendererRoot}`);
  }
  if (requireCore && !existsSync(coreEntry)) {
    throw new Error(`Missing Local AI Core build output: ${coreEntry}`);
  }
}

function coreEnv() {
  return {
    ...process.env,
    AI_WORKSTATION_USER_DATA_DIR:
      process.env.AI_WORKSTATION_USER_DATA_DIR || path.join(homedir(), '.agentdock'),
  };
}

function startCoreProcess({ stdio = 'inherit' } = {}) {
  ensureBuildOutput({ requireRenderer: false, requireCore: true });
  return spawn(process.execPath, [coreEntry], {
    cwd: process.cwd(),
    env: coreEnv(),
    stdio,
  });
}

async function isCoreHealthy(coreOrigin = defaultCoreOrigin) {
  try {
    const response = await fetch(`${coreOrigin.replace(/\/+$/, '')}/api/local/v1/health`, {
      signal: AbortSignal.timeout(500),
    });
    const json = await response.json();
    return response.ok && json?.ok && json?.data?.name === 'local-ai-core';
  } catch {
    return false;
  }
}

async function waitForCore(coreOrigin = defaultCoreOrigin, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isCoreHealthy(coreOrigin)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local AI Core did not become healthy at ${coreOrigin} within ${timeoutMs}ms`);
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[ext] || 'application/octet-stream';
}

function isCompressible(filePath) {
  return new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt']).has(path.extname(filePath).toLowerCase());
}

function preferredEncoding(req, filePath) {
  if (!isCompressible(filePath)) {
    return null;
  }
  const accepted = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(accepted)) {
    return 'br';
  }
  if (/\bgzip\b/.test(accepted)) {
    return 'gzip';
  }
  return null;
}

function isImmutableAsset(filePath) {
  const relative = path.relative(rendererRoot, filePath).split(path.sep).join('/');
  return relative.startsWith('assets/');
}

function staticEtag(filePath, stat) {
  const relative = path.relative(rendererRoot, filePath).split(path.sep).join('/');
  return `W/"${relative}:${stat.size}:${Math.trunc(stat.mtimeMs)}"`;
}

function matchesEtag(req, etag) {
  return String(req.headers['if-none-match'] || '')
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

function sendFile(req, res, filePath) {
  const stat = statSync(filePath);
  const etag = staticEtag(filePath, stat);
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeType(filePath));
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader(
    'Cache-Control',
    isImmutableAsset(filePath)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  if (matchesEtag(req, etag)) {
    res.statusCode = 304;
    res.end();
    return;
  }
  const encoding = preferredEncoding(req, filePath);
  if (encoding) {
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Vary', 'Accept-Encoding');
  } else {
    res.setHeader('Content-Length', stat.size);
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    res.end('Internal server error');
  });
  if (encoding === 'br') {
    stream.pipe(createBrotliCompress()).pipe(res);
    return;
  }
  if (encoding === 'gzip') {
    stream.pipe(createGzip()).pipe(res);
    return;
  }
  stream.pipe(res);
}

function resolveStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const candidate = path.resolve(rendererRoot, `.${decodedPath}`);
  if (!candidate.startsWith(`${rendererRoot}${path.sep}`) && candidate !== rendererRoot) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  const indexPath = path.join(rendererRoot, 'index.html');
  if (!path.extname(candidate) && existsSync(indexPath)) {
    return indexPath;
  }
  return null;
}

function proxyToCore(req, res, coreOrigin) {
  const upstream = new URL(req.url || '/', coreOrigin);
  const client = upstream.protocol === 'https:' ? https : http;
  const proxyReq = client.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: `${upstream.pathname}${upstream.search}`,
      headers: {
        ...req.headers,
        host: upstream.host,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (error) => {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Local AI Core proxy failed: ${error.message}`);
  });
  req.pipe(proxyReq);
}

function startWebServer({ host, port, coreOrigin }) {
  ensureBuildOutput({ requireRenderer: true, requireCore: false });
  const normalizedCoreOrigin = coreOrigin.replace(/\/+$/, '');
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    if (requestUrl.pathname === '/api/local/v1' || requestUrl.pathname.startsWith('/api/local/v1/')) {
      proxyToCore(req, res, normalizedCoreOrigin);
      return;
    }
    const filePath = resolveStaticPath(requestUrl.pathname);
    if (!filePath) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    sendFile(req, res, filePath);
  });
  server.listen(port, host, () => {
    console.log(`[agentdock] Web listening at http://${host}:${port}`);
    console.log(`[agentdock] Proxying /api/local/v1 to ${normalizedCoreOrigin}`);
  });
  return server;
}

async function runCore() {
  const child = startCoreProcess();
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

async function runWeb(flags) {
  const host = readFlag(flags, 'host', defaultHost);
  const port = readPort(flags, 'port', defaultWebPort);
  const coreOrigin = readFlag(flags, 'core-origin', defaultCoreOrigin);
  startWebServer({ host, port, coreOrigin });
}

async function runServe(flags) {
  const host = readFlag(flags, 'host', defaultHost);
  const port = readPort(flags, 'port', defaultWebPort);
  const coreOrigin = readFlag(flags, 'core-origin', defaultCoreOrigin);
  let coreProcess = null;
  if (!(await isCoreHealthy(coreOrigin))) {
    coreProcess = startCoreProcess();
    await waitForCore(coreOrigin);
  }
  const server = startWebServer({ host, port, coreOrigin });
  const shutdown = () => {
    server.close();
    if (coreProcess) {
      coreProcess.kill('SIGTERM');
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const { command, flags } = parseArgs(process.argv.slice(2));

try {
  if (command === 'core') {
    await runCore();
  } else if (command === 'web') {
    await runWeb(flags);
  } else if (command === 'serve') {
    await runServe(flags);
  } else {
    printHelp();
    process.exitCode = command === 'help' || command === '--help' || command === '-h' ? 0 : 1;
  }
} catch (error) {
  console.error(`[agentdock] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
