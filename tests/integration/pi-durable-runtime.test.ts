import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { PiDurableHost } from '../../services/local-ai-core/src/agents/pi-durable/host.js';
import { checkDurableExecutor } from '../../services/local-ai-core/src/agents/pi-durable/capability.js';

test('Durable SQLite has one owner, independent conversations, and stable submissions across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentdock-pi-durable-'));
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ id:'chatcmpl-fixture', object:'chat.completion.chunk', created:1, model:'mock-model', choices:[{index:0,delta:{content:'Recovered answer'},finish_reason:null}] })+'\n\ndata: '+JSON.stringify({ id:'chatcmpl-fixture', object:'chat.completion.chunk', created:1, model:'mock-model', choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5} })+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  const address = server.address() as {port:number};
  const config = { agentType:'pi-durable', workspaceId:'agentdock', command:process.execPath, args:[], workDir:directory, model:'mock-model', env:{OPENAI_API_KEY:'test-only-key',OPENAI_BASE_URL:`http://127.0.0.1:${address.port}/v1`} };
  const host = new PiDurableHost({ userDataPath:directory });
  let next: PiDurableHost | undefined;
  try {
    const a = {threadId:'thread:agentdock::c643ab1c-f7d6-4cf1-886a-5d1f1ba4e4f5',coreSubmissionId:'submission:a2d562cb-cf40-4769-a2e9-7a68bac235a4',coreRunId:'run:agentdock::c643ab1c-f7d6-4cf1-886a-5d1f1ba4e4f5:20261004T000000Z',prompt:'Hello A',config};
    const b = {...a,threadId:'thread:other::13afdc27-1458-4781-9533-eb9db725931d',coreSubmissionId:'submission:8846a44f-454e-467a-ae6c-e7518cb104ab',coreRunId:'run:other::13afdc27-1458-4781-9533-eb9db725931d:20261004T000001Z',prompt:'Hello B',config:{...config,workspaceId:'other'}};
    const [first,second]=await Promise.all([host.submit(a),host.submit(b)]);
    assert.equal(first.answer,'Recovered answer');
    assert.notEqual(first.conversationId,second.conversationId);
    assert.equal(calls,2);
    const competitor=new PiDurableHost({userDataPath:directory});
    await assert.rejects(competitor.start(),/owner|owned|lock/i);
    await competitor.close();
    await host.close();
    next=new PiDurableHost({userDataPath:directory});
    const again=await next.submit(a);
    assert.equal(again.durableSubmissionId,first.durableSubmissionId);
    assert.equal(again.conversationId,first.conversationId);
    assert.equal(calls,2);
    assert.equal(readdirSync(join(directory,'runtime')).filter((name)=>name.endsWith('.sqlite')).length,1);
  } finally {await next?.close();await host.close();await new Promise<void>((resolve)=>server.close(()=>resolve()));rmSync(directory,{recursive:true,force:true});}
});

test('a crashed worker releases the owner lock so later submissions recover instead of failing on a stale owner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentdock-pi-durable-crash-'));
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ id:'chatcmpl-fixture', object:'chat.completion.chunk', created:1, model:'mock-model', choices:[{index:0,delta:{content:'Recovered answer'},finish_reason:null}] })+'\n\ndata: '+JSON.stringify({ id:'chatcmpl-fixture', object:'chat.completion.chunk', created:1, model:'mock-model', choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5} })+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0,'127.0.0.1',resolve));
  const address = server.address() as {port:number};
  const config = { agentType:'pi-durable', workspaceId:'agentdock', command:process.execPath, args:[], workDir:directory, model:'mock-model', env:{OPENAI_API_KEY:'test-only-key',OPENAI_BASE_URL:`http://127.0.0.1:${address.port}/v1`} };
  const host = new PiDurableHost({ userDataPath:directory });
  try {
    const base = { threadId:'thread:agentdock::c643ab1c-f7d6-4cf1-886a-5d1f1ba4e4f5', coreSubmissionId:'submission:a2d562cb-cf40-4769-a2e9-7a68bac235a4', coreRunId:'run:agentdock::c643ab1c-f7d6-4cf1-886a-5d1f1ba4e4f5:20261004T000000Z', config };
    await host.submit({ ...base, prompt:'Hello' });
    // The worker self-terminates when a single stdin frame exceeds 4 MiB; the
    // submission request must fail, but the owner lock must not stay leaked.
    await assert.rejects(
      host.submit({ ...base, prompt:'x'.repeat(4*1024*1024+64) }),
      /exited|not running/i,
    );
    const recovered = await host.submit({
      ...base,
      coreSubmissionId:'submission:8846a44f-454e-467a-ae6c-e7518cb104ab',
      coreRunId:'run:agentdock::c643ab1c-f7d6-4cf1-886a-5d1f1ba4e4f5:20261006T000000Z',
      prompt:'Hello again',
    });
    assert.equal(recovered.answer,'Recovered answer');
  } finally {await host.close();await new Promise<void>((resolve)=>server.close(()=>resolve()));rmSync(directory,{recursive:true,force:true});}
});

test('the actual child executor capability reports SQLite and enforces the upstream engine requirement', async () => {
  const capability=await checkDurableExecutor(process.execPath);
  assert.equal(capability.available,true);
  assert.equal(capability.sqlite,true);
  assert.match(capability.version,/^v\d+/);
});
