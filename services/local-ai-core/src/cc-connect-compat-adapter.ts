import type { ThreadDetail, ThreadSummary } from '../../../packages/contracts/src/index.js';
import type { ManagementProject, ManagementSession, ManagementSessionDetail, WorkspaceRouterOptions, WorkspaceThreadBackend } from './workspace-router-types.js';
import { decodeThreadId, encodeThreadId } from './workspace-thread-id.js';
import { toThreadDetail, toThreadSummary } from './workspace-thread-mappers.js';

type CcConnectCompatAdapterOptions = {
  managementRequest: WorkspaceRouterOptions['managementRequest'];
  bridgeSendMessage: WorkspaceRouterOptions['bridgeSendMessage'];
  runThreadMap: Map<string, string>;
};

export class CcConnectCompatAdapter implements WorkspaceThreadBackend {
  constructor(private readonly options: CcConnectCompatAdapterOptions) {}

  async listProjects() {
    try {
      const payload = await this.options.managementRequest<{ projects: ManagementProject[] }>('GET', '/projects');
      return payload.projects || [];
    } catch {
      return [];
    }
  }

  async listThreads(workspaceId: string): Promise<ThreadSummary[]> {
    const payload = await this.options.managementRequest<{ sessions: ManagementSession[] }>(
      'GET',
      `/projects/${encodeURIComponent(workspaceId)}/sessions`,
    );
    return (payload.sessions || []).map((session) => toThreadSummary(workspaceId, session));
  }

  async createThread(workspaceId: string, title: string): Promise<ThreadDetail> {
    const chatId = `core-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionKey = `desktop:${workspaceId}:${chatId}`;
    const created = await this.options.managementRequest<{ id?: string }>(
      'POST',
      `/projects/${encodeURIComponent(workspaceId)}/sessions`,
      {
        session_key: sessionKey,
        name: title,
      },
    );
    const sessions = await this.options.managementRequest<{ sessions: ManagementSession[] }>(
      'GET',
      `/projects/${encodeURIComponent(workspaceId)}/sessions`,
    );
    const matched =
      (sessions.sessions || []).find((session) => session.id === created.id) ||
      (sessions.sessions || []).find((session) => session.session_key === sessionKey);
    if (!matched) {
      throw new Error('Created thread could not be loaded');
    }
    return this.getThread(encodeThreadId(workspaceId, matched.id));
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const detail = await this.options.managementRequest<ManagementSessionDetail>(
      'GET',
      `/projects/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}?history_limit=200`,
    );
    return toThreadDetail(workspaceId, detail);
  }

  async renameThread(threadId: string, title: string): Promise<ThreadDetail> {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    await this.options.managementRequest(
      'PATCH',
      `/projects/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
      { name: title },
    );
    return this.getThread(threadId);
  }

  async deleteThread(threadId: string) {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    await this.options.managementRequest('DELETE', `/projects/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`);
    return { deleted: true };
  }

  async sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }> {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const detail = await this.options.managementRequest<any>(
      'GET',
      `/projects/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}?history_limit=1`,
    );
    const sessionKey = String(detail.session_key || '');
    if (sessionKey.startsWith('desktop:')) {
      const [, project = workspaceId, chatId = 'main'] = sessionKey.split(':');
      const result = await this.options.bridgeSendMessage({ project, chatId, content });
      this.options.runThreadMap.set(result.messageId, threadId);
      return { runId: result.messageId };
    }
    await this.options.managementRequest('POST', `/projects/${encodeURIComponent(workspaceId)}/sessions/switch`, {
      session_key: detail.session_key,
      session_id: detail.id,
    }).catch(() => undefined);
    await this.options.managementRequest('POST', `/projects/${encodeURIComponent(workspaceId)}/send`, {
      session_key: detail.session_key,
      message: content,
    });
    const runId = `run:${threadId}:${Date.now()}`;
    this.options.runThreadMap.set(runId, threadId);
    return { runId };
  }

  async sendThreadAction(threadId: string, content: string) {
    return this.sendThreadMessage(threadId, content);
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    const threadId = this.options.runThreadMap.get(runId);
    if (!threadId) {
      return { interrupted: false };
    }
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const detail = await this.options.managementRequest<any>(
      'GET',
      `/projects/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}?history_limit=1`,
    );
    const sessionKey = String(detail.session_key || '');
    if (!sessionKey.startsWith('desktop:')) {
      return { interrupted: false };
    }
    await this.stopDesktopSession(sessionKey, workspaceId);
    return { interrupted: true };
  }

  async sendDesktopProbe(workspaceId: string, chatId: string, content: string) {
    const sessionKey = `desktop:${workspaceId}:${chatId}`;
    const result = await this.options.bridgeSendMessage({ project: workspaceId, chatId, content });
    return {
      runId: String(result.messageId || ''),
      sessionKey,
    };
  }

  async stopDesktopSession(sessionKey: string, fallbackWorkspaceId: string) {
    if (!sessionKey.startsWith('desktop:')) {
      return;
    }
    const [, project = fallbackWorkspaceId, chatId = 'main'] = sessionKey.split(':');
    await this.options.bridgeSendMessage({ project, chatId, content: '/stop' });
  }

  async cleanupProbeSession(workspaceId: string, sessionKey: string) {
    try {
      const payload = await this.options.managementRequest<{ sessions: ManagementSession[] }>(
        'GET',
        `/projects/${encodeURIComponent(workspaceId)}/sessions`,
      );
      const matched = (payload.sessions || []).find((session) => session.session_key === sessionKey);
      if (!matched) {
        return;
      }
      await this.options.managementRequest(
        'DELETE',
        `/projects/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(matched.id)}`,
      );
    } catch {
      // Best effort cleanup for probe sessions.
    }
  }
}
