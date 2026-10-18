export type HistoryScrollAnchor = {
  element: HistoryScrollAnchorElement;
  top: number;
};

export type HistoryScrollAnchorElement = {
  getBoundingClientRect: () => { top: number; bottom: number };
  isConnected: boolean;
};

export type HistoryScrollContainer = {
  scrollTop: number;
  getBoundingClientRect: () => { top: number };
  querySelectorAll: (selector: string) => ArrayLike<HistoryScrollAnchorElement>;
};

const historyMessageAnchorSelector = '[data-chat-message-anchor]';

export function captureHistoryScrollAnchor(container: HistoryScrollContainer): HistoryScrollAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const messageElements = container.querySelectorAll(historyMessageAnchorSelector);
  for (let index = 0; index < messageElements.length; index += 1) {
    const element = messageElements[index];
    if (!element) continue;
    const messageRect = element.getBoundingClientRect();
    if (messageRect.bottom > containerTop) {
      return { element, top: messageRect.top - containerTop };
    }
  }
  return null;
}

export function restoreHistoryScrollAnchor(
  container: HistoryScrollContainer,
  anchor: HistoryScrollAnchor,
): boolean {
  if (!anchor.element.isConnected) return false;
  const containerTop = container.getBoundingClientRect().top;
  const currentTop = anchor.element.getBoundingClientRect().top - containerTop;
  container.scrollTop += currentTop - anchor.top;
  return true;
}
