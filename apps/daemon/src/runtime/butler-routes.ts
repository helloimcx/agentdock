export type ButlerRoute =
  | { name: 'butler.bots.list' }
  | { name: 'butler.profile.get' }
  | { name: 'butler.profile.configure' }
  | { name: 'butler.tasks.list' }
  | { name: 'butler.tasks.create' }
  | { name: 'butler.task.get'; taskId: string }
  | { name: 'butler.task.delegate'; taskId: string }
  | { name: 'butler.task.followup'; taskId: string }
  | { name: 'butler.task.cancel'; taskId: string }
  | { name: 'butler.task.complete'; taskId: string }
  | { name: 'butler.agent.command' };

export function parseButlerRoute(method: string, segments: string[]): ButlerRoute | null {
  if (segments.length === 2 && segments[1] === 'bots' && method === 'GET') return { name: 'butler.bots.list' };
  if (segments.length === 2 && segments[1] === 'agent' && method === 'POST') return { name: 'butler.agent.command' };
  if (segments.length === 2 && segments[1] === 'profile') return profileRoute(method);
  return segments[1] === 'tasks' ? taskRoute(method, segments) : null;
}

function taskRoute(method: string, segments: string[]): ButlerRoute | null {
  return segments.length === 2 ? taskCollectionRoute(method) : taskItemRoute(method, segments);
}

function taskCollectionRoute(method: string): ButlerRoute | null {
  if (method === 'GET') return { name: 'butler.tasks.list' };
  return method === 'POST' ? { name: 'butler.tasks.create' } : null;
}

function taskItemRoute(method: string, segments: string[]): ButlerRoute | null {
  const taskId = decodeURIComponent(segments[2] || '').trim();
  if (!taskId) return null;
  if (segments.length === 3 && method === 'GET') return { name: 'butler.task.get', taskId };
  if (segments.length !== 4 || method !== 'POST') return null;
  switch (segments[3]) {
    case 'delegations': return { name: 'butler.task.delegate', taskId };
    case 'followup': return { name: 'butler.task.followup', taskId };
    case 'cancel': return { name: 'butler.task.cancel', taskId };
    case 'complete': return { name: 'butler.task.complete', taskId };
    default: return null;
  }
}

function profileRoute(method: string): ButlerRoute | null {
  if (method === 'GET') return { name: 'butler.profile.get' };
  if (method === 'PUT') return { name: 'butler.profile.configure' };
  return null;
}
