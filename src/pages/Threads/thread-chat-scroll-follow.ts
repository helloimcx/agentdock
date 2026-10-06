export type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const bottomFollowThreshold = 80;

export function shouldFollowChatScroll(container: ChatScrollMetrics): boolean {
  return container.scrollHeight - container.clientHeight - container.scrollTop <= bottomFollowThreshold;
}
