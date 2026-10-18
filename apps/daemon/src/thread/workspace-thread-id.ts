export function encodeThreadId(workspaceId: string, sessionId: string) {
  return `${encodeURIComponent(workspaceId)}::${encodeURIComponent(sessionId)}`;
}

export function decodeThreadId(threadId: string) {
  const [workspacePart, sessionPart] = threadId.split('::');
  if (!workspacePart || !sessionPart) {
    throw new Error(`Invalid thread id: ${threadId}`);
  }
  return {
    workspaceId: decodeURIComponent(workspacePart),
    sessionId: decodeURIComponent(sessionPart),
  };
}
