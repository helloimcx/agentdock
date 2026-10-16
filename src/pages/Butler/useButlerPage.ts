import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelButlerTask, completeButlerTask, followupButlerTask, getButlerProfile, listButlerBots, listButlerTasks, setButlerProfile } from '@cc/core-sdk/butler';
import { listWorkspaces } from '@cc/core-sdk/threads';
import type { ButlerBotEndpoint, ButlerProfile, ButlerTask, WorkspaceSummary } from '@cc/superai-contracts';

export function useButlerPage() {
  const [profile, setProfile] = useState<ButlerProfile | null>(null);
  const [bots, setBots] = useState<ButlerBotEndpoint[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [tasks, setTasks] = useState<ButlerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const owner = useRef('');
  const polling = useRef(false);
  const retryIds = useRef(new Map<string, { content: string; id: string }>());
  const loadTasks = useCallback(async (threadId = owner.current) => {
    if (!threadId || polling.current) return;
    polling.current = true;
    try {
      const result = await listButlerTasks(threadId);
      if (alive.current && owner.current === threadId) { setTasks(result.tasks); setError(''); }
    } catch (failure) {
      if (alive.current && owner.current === threadId) setError(String(failure instanceof Error ? failure.message : failure));
    } finally { polling.current = false; }
  }, []);
  const reload = useCallback(async () => {
    setActionError('');
    try {
      const [current, result, discovered] = await Promise.all([getButlerProfile(), listWorkspaces(), listButlerBots()]);
      if (!alive.current) return;
      owner.current = current?.threadId || '';
      setProfile(current);
      setWorkspaces(result.workspaces);
      setBots(discovered.bots);
      setError('');
      if (current) await loadTasks(current.threadId);
      else setTasks([]);
    } catch (failure) {
      if (alive.current) setError(String(failure instanceof Error ? failure.message : failure));
    } finally { if (alive.current) setLoading(false); }
  }, [loadTasks]);
  useEffect(() => {
    alive.current = true;
    void reload();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void loadTasks(); }, 3000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [reload, loadTasks]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      await loadTasks();
      return true;
    } catch (failure) {
      if (alive.current) setActionError(String(failure instanceof Error ? failure.message : failure));
      return false;
    } finally { if (alive.current) setBusy(false); }
  };
  const configure = (managerBotId: string, managedBots: Array<{ botId: string; sharedChatId: string }>) => perform(async () => {
    const next = await setButlerProfile({ managerBotId, managedBots });
    if (alive.current) { owner.current = next.threadId; setProfile(next); setTasks([]); }
  });
  const followup = (task: ButlerTask, delegationId: string, content: string) => perform(async () => {
    const key = `${task.id}:${delegationId}`;
    const previous = retryIds.current.get(key);
    const request = previous?.content === content ? previous : { content, id: `butler-followup:${crypto.randomUUID()}` };
    retryIds.current.set(key, request);
    await followupButlerTask(task.id, { ownerThreadId: task.ownerThreadId, delegationId, content, requestId: request.id });
    retryIds.current.delete(key);
  });
  return { profile, bots, workspaces, tasks, loading, error: actionError || error, busy, reload, configure, followup,
    cancel: (task: ButlerTask) => perform(() => cancelButlerTask(task.id, task.ownerThreadId)),
    complete: (task: ButlerTask, summary: string) => perform(() => completeButlerTask(task.id, task.ownerThreadId, summary)),
  };
}
