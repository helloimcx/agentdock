/**
 * Resolves the deliberately small first-release secret reference surface.
 * Values are returned only to the process environment and are never included
 * in errors, metadata, or diagnostics.
 */
export interface AutomationSecretResolver {
  get(name: string): Promise<string | undefined> | string | undefined;
}

export class EnvironmentSecretResolver implements AutomationSecretResolver {
  get(name: string) {
    return process.env[name];
  }
}

export class SecretUnavailableError extends Error {
  readonly code = 'secret_unavailable';
  constructor(readonly name: string) {
    super(`secret_unavailable: ${name}`);
    this.name = 'SecretUnavailableError';
  }
}

export async function resolveDeclaredEnvironmentSecrets(
  secretRefs: string[],
  envNames: string[],
  resolver: AutomationSecretResolver,
): Promise<NodeJS.ProcessEnv> {
  const declared = new Set(envNames);
  const result: NodeJS.ProcessEnv = {};
  for (const ref of secretRefs) {
    if (!ref.startsWith('env://')) throw new SecretUnavailableError('unsupported_reference');
    const name = ref.slice('env://'.length);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !declared.has(name)) {
      throw new SecretUnavailableError(name || 'invalid_reference');
    }
    const value = await resolver.get(name);
    if (value === undefined) throw new SecretUnavailableError(name);
    result[name] = value;
  }
  return result;
}
