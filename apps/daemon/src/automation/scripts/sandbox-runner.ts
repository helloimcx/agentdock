/**
 * Platform-neutral execution boundary for automation scripts.
 *
 * Callers deliberately receive process output only.  The adapter owns the
 * shell command returned by the native sandbox runtime and never exposes it
 * as part of this contract.
 */
export type SandboxNetworkMode = 'none' | 'public' | 'restricted';

export interface SandboxRunInput {
  /** Shell command to execute inside the sandbox. */
  command: string;
  interpreterPath?: string;
  /** Working directory visible to the child process. */
  cwd?: string;
  /** Immutable staged package directory. It is always read-only. */
  packagePath?: string;
  /** The only directory writable by the child process. */
  tempDir?: string;
  network?: SandboxNetworkMode;
  /** Domains used by restricted network mode. */
  allowedDomains?: string[];
  /** Optional approved manifest, used to derive capability fields. */
  manifest?: {
    env?: string[];
    capabilities?: {
      network?: SandboxNetworkMode;
      allowedReadDirs?: string[];
      allowedDomains?: string[];
    };
  };
  /** Explicit paths that must not be readable by the child. */
  denyRead?: string[];
  /** Additional read roots approved by the manifest. */
  allowedReadDirs?: string[];
  env?: NodeJS.ProcessEnv;
  allowedEnv?: string[];
  /** UTF-8 protocol request written once to the child standard input. */
  stdin?: string;
  /** Streaming output ceilings; the adapter terminates the process tree on overflow. */
  stdoutBytes?: number;
  stderrBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Compatibility aliases for integrations that call the fields by name. */
  packageRoot?: string;
  workspacePath?: string;
  userDataPath?: string;
  temporaryDirectory?: string;
  tempPath?: string;
  /** Controlled root under which tempDir must reside. */
  tempRoot?: string;
  networkMode?: SandboxNetworkMode;
}

export interface SandboxRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  outputLimitExceeded?: 'stdout' | 'stderr';
  networkAudit?: Array<{ host: string; port?: number; allowed: boolean; timestamp: string }>;
}

export interface SandboxCapabilityProbe {
  available: boolean;
  platform: string;
  /** Stable capability identifiers suitable for diagnostics and skip output. */
  missing: string[];
  /** Missing capabilities whose behavioral proof could not run because an earlier prerequisite failed. */
  unverified?: string[];
}

export interface SandboxRunner {
  probe(): Promise<SandboxCapabilityProbe>;
  run(input: SandboxRunInput): Promise<SandboxRunResult>;
}
