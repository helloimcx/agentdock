/** These programs are fixed sources. Browser values travel over stdin, never shell interpolation. */
const NODE_SELECTION = `
NODE_BIN=''
for candidate in node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node /opt/local/bin/node /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node "$HOME/.volta/bin/node" "$HOME"/.nvm/versions/node/*/bin/node; do
  if "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then NODE_BIN="$candidate"; break; fi
done
if [ -z "$NODE_BIN" ]; then printf 'NODE_REQUIRED\\n' >&2; exit 46; fi
`;

function quote(source: string) { return `'${source.replace(/'/g, `'"'"'`)}'`; }
function shell(source: string) { return `exec /bin/sh -c ${quote(source)}`; }

export const NODE_PROBE = shell(`${NODE_SELECTION}\n# AGENTDOCK_NODE_PROBE\nexec "$NODE_BIN" -e ${quote('console.log(JSON.stringify({major:Number(process.versions.node.split(".")[0]),platform:process.platform}))')}`);

const UPLOAD = `
// AGENTDOCK_RUNTIME_UPLOAD
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
try {
 const input=JSON.parse(fs.readFileSync(0,'utf8'));
 if(!/^[a-f0-9]{64}$/.test(input.sha256)||typeof input.content!=='string'||input.content.length>12*1024*1024) throw Error();
 const bytes=Buffer.from(input.content,'base64');
 if(bytes.length>8*1024*1024||crypto.createHash('sha256').update(bytes).digest('hex')!==input.sha256) throw Error();
 let directory=os.homedir();
 for(const name of ['', '.agentdock','mesh','runtimes']) {
  if(name) directory=path.join(directory,name);
  try { fs.mkdirSync(directory,{mode:0o700}); } catch(e) { if(e.code!=='EEXIST') throw e; }
  const info=fs.lstatSync(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o022)||(process.getuid&&info.uid!==process.getuid())) throw Error();
 }
 const final=path.join(directory,input.sha256+'.cjs');
 const valid=()=>{
  const fd=fs.openSync(final,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try { const info=fs.fstatSync(fd); return info.isFile()&&info.size===bytes.length&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid())&&crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex')===input.sha256; }
  finally { fs.closeSync(fd); }
 };
 if(fs.existsSync(final)) { if(!valid()) throw Error(); }
 else {
  const temporary=path.join(directory,'.upload-'+crypto.randomBytes(12).toString('hex'));
  let fd;
  try {
   fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
   try { fs.linkSync(temporary,final); } catch(e) { if(e.code!=='EEXIST'||!valid()) throw e; }
  } finally { if(fd!==undefined) fs.closeSync(fd); try {fs.unlinkSync(temporary);} catch {} }
 }
 console.log(JSON.stringify({deployed:true}));
} catch { console.log(JSON.stringify({errorCode:'RUNTIME_INVALID'})); process.exitCode=47; }
`;

export const RUNTIME_UPLOAD = shell(`${NODE_SELECTION}\nexec "$NODE_BIN" -e ${quote(UPLOAD)}`);

export function runtimeCommand(sha256: string, command: 'inspect' | 'inspect-forward' | 'run'): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid runtime digest.');
  return shell(`${NODE_SELECTION}\nexec "$NODE_BIN" "$HOME/.agentdock/mesh/runtimes/${sha256}.cjs" ${command}`);
}
