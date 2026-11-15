import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer as tcpServer, connect } from 'node:net';
import { createServer } from 'node:http';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { SshBootstrapTransport } from '../../apps/daemon/src/mesh/ssh-bootstrap.js';
import type { BootstrapTarget } from '../../apps/daemon/src/mesh/tailscale-transport.js';

const enabled = process.env.AGENTDOCK_SSH_INTEGRATION === '1';
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

const runtime = `
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),cp=require('node:child_process');
let buffer='',handled=false;
process.stdin.on('data',data=>{
 buffer+=data;
 const newline=buffer.indexOf('\\n'); if(newline<0||handled)return; handled=true;
 const input=JSON.parse(buffer.slice(0,newline));
 if(process.argv[2]==='inspect') { console.log(JSON.stringify({controllerId:input.controllerId,root:path.join(os.homedir(),'AgentDock'),credentialsPresent:false}));process.exit(0); }
 if(process.argv[2]==='inspect-forward') {
  const out=cp.execFileSync('/usr/sbin/lsof',['-nP','-iTCP:'+input.port,'-sTCP:LISTEN','-Fn'],{encoding:'utf8'});
  const names=out.split('\\n').filter(line=>line.startsWith('n')).map(line=>line.slice(1));
  console.log(JSON.stringify({loopbackOnly:names.length>0&&names.every(name=>name==='127.0.0.1:'+input.port||name==='[::1]:'+input.port),port:input.port}));process.exit(0);
 }
 const request=http.get(input.server+'/probe',response=>{response.resume();response.on('end',()=>console.log(JSON.stringify({status:'connected'})));});
 request.on('error',()=>{console.log(JSON.stringify({errorCode:'BOOTSTRAP_FAILED'}));process.exit(1);});
});
process.stdin.on('end',()=>{fs.writeFileSync(path.join(os.homedir(),'bootstrap-eof'),'stopped');process.exit(0);});
`;

async function availablePort() {
  const server = tcpServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function waitListener(port: number, failed: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (failed()) throw new Error('Temporary sshd exited before listening.');
    const ready = await new Promise<boolean>(resolve => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Temporary sshd did not start.');
}

test('real temporary OpenSSH authenticates, transfers runtime, forwards privately and stops on EOF', { skip: !enabled || process.platform !== 'darwin', timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mesh-real-ssh-'));
  const remoteHome = join(directory, 'remote-home'); await mkdir(remoteHome, { mode: 0o700 });
  const port = await availablePort();
  for (const name of ['host', 'client']) {
    const generated = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(directory, name)]);
    assert.equal(generated.status, 0, generated.stderr?.toString());
  }
  await writeFile(join(directory, 'authorized_keys'), await readFile(join(directory, 'client.pub')), { mode: 0o600 });
  const known = `[127.0.0.1]:${port} ` + await readFile(join(directory, 'host.pub'), 'utf8');
  await writeFile(join(directory, 'known_hosts'), known);
  await writeFile(join(directory, 'untrusted_hosts'), '');
  const config = `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${join(directory, 'host')}\nPidFile ${join(directory, 'pid')}\nAuthorizedKeysFile ${join(directory, 'authorized_keys')}\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes no\nAllowUsers ${userInfo().username}\nAllowTcpForwarding remote\nGatewayPorts no\n`;
  await writeFile(join(directory, 'sshd_config'), config);
  // StrictModes=no is confined to this disposable sshd because temporary parent directories are world-writable.
  const sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(directory, 'sshd_config')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let sshdOutput = ''; sshd.stderr.on('data', data => { sshdOutput = (sshdOutput + data).slice(-4000); });
  const bridge = createServer((_req, res) => { res.end('forwarded'); requestSeen(); });
  let requestSeen!: () => void;
  const reached = new Promise<void>(resolve => { requestSeen = resolve; });
  let running: Awaited<ReturnType<Awaited<ReturnType<SshBootstrapTransport['prepare']>>['start']>> | undefined;
  let prepared: Awaited<ReturnType<SshBootstrapTransport['prepare']>> | undefined;
  try {
    await waitListener(port, () => sshd.exitCode !== null);
    await new Promise<void>(resolve => bridge.listen(0, '127.0.0.1', resolve));
    const bytes = Buffer.from(runtime), sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, 'bootstrap.cjs'), bytes);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ file: 'bootstrap.cjs', sha256, protocol: 1, nodeMajor: 22 }));
    const target: BootstrapTarget = {
      peer: { id: 'nLiveSshTest', name: 'test-peer', dnsName: '', ips: ['100.64.0.8'], os: 'macOS', online: true, stableIdentity: true },
      connection: { id: 'mesh-connection:00000000-0000-4000-8000-000000000001', peerId: 'nLiveSshTest', sshUser: userInfo().username, approvedRoot: '~/AgentDock', allowShell: false, status: 'connecting', desiredState: 'active', operationId: 'mesh-operation:00000000-0000-4000-8000-000000000002', createdAt: '', updatedAt: '' },
      controllerId: '00000000-0000-4000-8000-000000000003', signal: new AbortController().signal, onStage() {},
    };
    const makeTransport = (knownHosts: string) => new SshBootstrapTransport({ artifactDir: directory, timeoutMs: 8000, spawnSsh: original => {
      const args = [...original]; args[args.indexOf('-p') + 1] = String(port);
      const destination = args.indexOf('--') + 1; args[destination] = '127.0.0.1';
      if (args.length > destination + 1) args[destination + 1] = `env HOME=${quote(remoteHome)} ${args[destination + 1]}`;
      return spawn('/usr/bin/ssh', ['-i', join(directory, 'client'), '-o', `UserKnownHostsFile=${join(directory, knownHosts)}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'IdentitiesOnly=yes', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    } });
    await assert.rejects(makeTransport('untrusted_hosts').prepare(target), { code: 'SSH_HOST_KEY' });
    prepared = await makeTransport('known_hosts').prepare(target);
    running = await prepared.start({ controllerId: target.controllerId, expectedNodeId: 'node:00000000-0000-4000-8000-000000000004', root: prepared.inspection.root, allowShell: false, pairingToken: 'ssh-integration-single-use' }, (bridge.address() as { port: number }).port);
    await Promise.race([reached, new Promise((_, reject) => setTimeout(() => reject(Error('Reverse forward did not reach its bridge.')), 8000))]);
    await running.stop();
    assert.equal((await running.closed).code, 'STOPPED');
    assert.equal(await readFile(join(remoteHome, 'bootstrap-eof'), 'utf8'), 'stopped');
    assert.equal(await readFile(join(remoteHome, '.agentdock/mesh/runtimes', sha256 + '.cjs'), 'utf8'), runtime);
  } catch (error) { assert.fail(`${error instanceof Error ? error.message : error}\n${sshdOutput}`); }
  finally {
    await running?.stop(); await prepared?.stop();
    await new Promise<void>(resolve => bridge.close(() => resolve()));
    sshd.kill('SIGTERM');
    await new Promise<void>(resolve => { if (sshd.exitCode !== null) resolve(); else sshd.once('close', () => resolve()); });
    await rm(directory, { recursive: true, force: true });
  }
});
