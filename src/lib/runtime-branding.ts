export interface RuntimeBranding {
  chatTitle: string;
  chatHeading: string;
  chatDescription: string;
  scopeLabel: string;
  scopeSelectPlaceholder: string;
  searchPlaceholder: string;
  startRuntimeLabel: string;
  startingRuntimeLabel: string;
  newThreadLabel: string;
  pendingRestartLabel: string;
  emptySelectionLabel: string;
  emptyThreadsLabel: string;
  emptySearchLabel: string;
  collectionLabel: string;
  activeScopeLabel: string;
  activeConversationFallback: string;
  startConversationLabel: string;
  runtimeOnlineLabel: string;
  runtimeOfflineLabel: string;
  emptyConversationLabel: string;
  startFirstPlaceholder: string;
  waitingRuntimePlaceholder: string;
  sendPlaceholder: string;
  permissionUnsupportedLabel: string;
  replyTimeoutLabel: string;
}

export function getRuntimeBranding(): RuntimeBranding {
  return {
      chatTitle: '本地对话',
      chatHeading: '本地对话',
      chatDescription: '浏览线程、切换工作区，并与本地 AI Core 保持同步。',
      scopeLabel: '当前工作区',
      scopeSelectPlaceholder: '选择工作区',
      searchPlaceholder: '搜索线程、联系人或消息摘要',
      startRuntimeLabel: '启动运行时',
      startingRuntimeLabel: '启动中…',
      newThreadLabel: '新建线程',
      pendingRestartLabel: '最新配置已经保存，但当前对话仍在使用旧运行时状态。请重启运行时以应用配置。',
      emptySelectionLabel: '选择工作区后即可开始对话。',
      emptyThreadsLabel: '当前还没有线程。',
      emptySearchLabel: '没有匹配的线程。',
      collectionLabel: '线程',
      activeScopeLabel: '当前工作区',
      activeConversationFallback: '新对话',
      startConversationLabel: '选择工作区后即可开始聊天。',
      runtimeOnlineLabel: '运行时在线',
      runtimeOfflineLabel: '运行时离线',
      emptyConversationLabel: '发送一条消息，即可在当前工作区创建新线程。',
      startFirstPlaceholder: '请先启动运行时',
      waitingRuntimePlaceholder: '正在等待运行时通道连接',
      sendPlaceholder: '输入一条发给当前线程的消息',
      permissionUnsupportedLabel: '当前代理无法在此对话中继续交互式审批。请切换到支持的代理，或调整运行时权限后重试。',
      replyTimeoutLabel: '审批回复已发送，但代理没有继续执行。该请求可能暂不支持本地运行时继续处理。',
  };
}
