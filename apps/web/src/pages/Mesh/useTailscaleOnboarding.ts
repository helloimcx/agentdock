import { useCallback, useEffect, useRef, useState } from 'react';
import { createMeshClient } from '@cc/core-sdk/mesh';
import { getMeshAdminToken } from '@cc/core-sdk/runtime';
import type { TailscaleConnection, TailscaleConnectionInput, TailscaleConnectionResult } from '@cc/superai-contracts/mesh-onboarding';
import type { MeshNode } from '@cc/superai-contracts';
import { operationFinished, readyExecutionNode } from './onboarding-model';

type Profile = Pick<TailscaleConnectionInput, 'sshUser' | 'approvedRoot' | 'allowShell'>;

export function useTailscaleOnboarding(peerId: string, connection?: TailscaleConnection) {
  const client = useCallback(() => createMeshClient(getMeshAdminToken()), []);
  const [result, setResult] = useState<TailscaleConnectionResult>();
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pollError, setPollError] = useState('');
  const key = useRef(crypto.randomUUID());
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const accept = useCallback(async (next: TailscaleConnectionResult) => {
    if (!mounted.current) return;
    setResult(next);
    if (next.operation.stage === 'ready') {
      try {
        const response = await client().listNodes();
        if (mounted.current) { setNodes(response.nodes); setPollError(''); }
      } catch (cause) {
        if (mounted.current) setPollError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, [client]);

  useEffect(() => {
    if (connection?.status !== 'connecting') return;
    void client().getTailscaleOperation(connection.operationId).then(accept).catch(cause => {
      if (mounted.current) setPollError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [client, connection?.operationId, connection?.status, accept]);

  const operationId = result?.operation.id;
  const finished = result ? operationFinished(result.operation.stage) : true;
  useEffect(() => {
    if (!operationId || finished) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let terminal = false;
      try {
        const next = await client().getTailscaleOperation(operationId);
        terminal = operationFinished(next.operation.stage);
        if (!disposed) { await accept(next); setPollError(''); }
      } catch (cause) {
        if (!disposed) setPollError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed && !terminal) timer = setTimeout(() => { void poll(); }, 1500);
      }
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [client, operationId, finished, accept]);

  const targetPending = Boolean(result?.operation.stage === 'ready' && result.connection.allowShell && !readyExecutionNode(result, nodes));
  useEffect(() => {
    if (!targetPending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await client().listNodes();
        if (disposed) return;
        setNodes(response.nodes);
        setPollError('');
      } catch (cause) {
        if (!disposed) setPollError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed) timer = setTimeout(() => { void refresh(); }, 1500);
      }
    };
    timer = setTimeout(() => { void refresh(); }, 1500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [client, targetPending]);

  const start = async (profile: Profile, reauthorize: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setActionError('');
    setPollError('');
    if (result && operationFinished(result.operation.stage)) key.current = crypto.randomUUID();
    try {
      const input = { ...profile, idempotencyKey: key.current };
      const target = result?.connection || connection;
      const next = reauthorize && target
        ? await client().reauthorizeTailscaleConnection(target.id, input)
        : await client().createTailscaleConnection({ ...input, peerId });
      await accept(next);
    } catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  };

  const cancel = async () => {
    if (!result || busy.current) return;
    busy.current = true;
    setPending(true);
    try { await accept(await client().cancelTailscaleOperation(result.operation.id)); }
    catch (cause) { if (mounted.current) setActionError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };

  return { result, nodes, pending, error: actionError || pollError, targetPending, start, cancel };
}
