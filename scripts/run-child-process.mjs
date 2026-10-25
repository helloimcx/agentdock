import { spawnSync } from 'node:child_process';

export function runChildProcess(command, args, options, spawn = spawnSync) {
  const result = spawn(command, args, options);
  if (result.error) console.error(`Failed to start ${command}: ${result.error.message}`);
  if (result.signal) console.error(`${command} was terminated by ${result.signal}.`);
  return result.status ?? 1;
}
