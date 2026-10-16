import { execFileSync } from 'node:child_process';
execFileSync(process.platform==='win32'?'pnpm.cmd':'pnpm',['--config.verify-deps-before-run=false','exec','tsc','-p','services/local-ai-core/src/agents/pi-durable/tsconfig.worker.json'],{stdio:'inherit'});
