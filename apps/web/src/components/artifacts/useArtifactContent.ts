import { useState, useEffect, useCallback } from 'react';
import { runtime as runtimeApi } from '@cc/core-sdk';
import type { AgentTaskArtifact, AgentTaskArtifactContent } from '@cc/superai-contracts';

export function useArtifactContent(taskId: string, artifact: AgentTaskArtifact) {
  const [data, setData] = useState<AgentTaskArtifactContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await runtimeApi.getTaskArtifactContent(taskId, artifact.id);
      setData(res);
    } catch (err) {
      if (artifact.summary || artifact.metadata?.content) {
        const text = (artifact.metadata?.content as string) || artifact.summary || '';
        setData({
          id: artifact.id,
          taskId,
          title: artifact.title,
          kind: artifact.kind || 'text',
          mimeType: (artifact.metadata?.mimeType as string) || 'text/plain',
          content: text,
          isBinary: false,
          sizeBytes: text.length,
          path: artifact.path,
          url: artifact.url,
        });
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, artifact]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  return { data, loading, error };
}
