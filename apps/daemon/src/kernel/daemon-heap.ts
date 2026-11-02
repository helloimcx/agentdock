const DEFAULT_MAX_OLD_SPACE_MB = 1024;

export interface DaemonHeapOptions {
  readonly maxOldSpaceMb: number | null;
}

export function resolveDaemonHeapOptions(
  env: Record<string, string | undefined> = process.env,
): DaemonHeapOptions {
  const raw = env.AI_WORKSTATION_DAEMON_MAX_OLD_SPACE_MB?.trim();
  const parsed = raw && /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : Number.NaN;
  const maxOldSpaceMb =
    parsed === 0
      ? null
      : Number.isInteger(parsed) && parsed > 0 && parsed <= Number.MAX_SAFE_INTEGER
        ? parsed
        : DEFAULT_MAX_OLD_SPACE_MB;
  return { maxOldSpaceMb };
}

// The daemon child defaults to V8's full old-space ceiling, which on small
// hosts lets a leak escalate into a kernel global OOM that kills arbitrary
// processes. Cap it via NODE_OPTIONS (spawn options cannot carry execArgv);
// V8 honors the last occurrence, so appending overrides any existing value.
export function withDaemonHeapOptions(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const { maxOldSpaceMb } = resolveDaemonHeapOptions(env);
  if (maxOldSpaceMb === null) {
    return { ...env };
  }
  const flag = `--max-old-space-size=${maxOldSpaceMb}`;
  const existing = env.NODE_OPTIONS?.trim();
  return { ...env, NODE_OPTIONS: existing ? `${existing} ${flag}` : flag };
}
