export function getPathEnv(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  let pathValue = '';
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === 'path') {
      pathValue = String(value || '');
    }
  }
  return pathValue;
}
