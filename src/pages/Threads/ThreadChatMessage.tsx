import { useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ShieldCheck,
  Terminal,
  User,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { cn } from '@/lib/utils';
import { formatMessageTimestamp, type ChatMessage } from './thread-chat-model';
import {
  parsePermissionCardContent,
  shouldCollapseToolResultByDefault,
  toolCallToResultCard,
  type PermissionCard,
  type ToolResultCard,
} from './thread-chat-message-blocks';

type ChatAction = NonNullable<ChatMessage['actions']>[number][number];

function ToolResultCardView({ card }: { card: ToolResultCard }) {
  const completed = card.status.toLowerCase() === 'completed';
  const [expanded, setExpanded] = useState(() => !shouldCollapseToolResultByDefault(card));
  const hasOutput = Boolean(card.output.trim());
  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-[#f5f5f7] dark:border-white/[0.08] dark:bg-[#111214]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-primary">
            <Wrench size={14} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Terminal size={12} />
              <span className="truncate">{card.subtitle || card.label}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
              completed
                ? 'bg-primary/10 text-primary dark:text-primary'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
            )}
          >
            {card.status}
          </span>
          {hasOutput ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? '折叠工具结果' : '展开工具结果'}
              data-testid="desktop-tool-result-toggle"
              onClick={() => setExpanded((current) => !current)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-slate-700 [scrollbar-gutter:stable] dark:text-slate-200">
          {card.output || '无输出'}
        </pre>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs text-slate-500 transition hover:bg-slate-100/70 dark:text-slate-400 dark:hover:bg-white/[0.04]"
        >
          <ChevronRight size={14} />
          <span className="truncate">工具结果已折叠</span>
        </button>
      )}
    </div>
  );
}

export function PermissionRequestCardView({
  card,
  className,
  testId = 'desktop-chat-permission-card',
  loading,
  onAction,
}: {
  card: PermissionCard;
  className?: string;
  testId?: string;
  loading: boolean;
  onAction: (action: ChatAction) => void;
}) {
  const parsed = parsePermissionCardContent(card.content);
  return (
    <div
      data-testid={testId}
      className={cn(
        'overflow-hidden rounded-[18px] border border-amber-200 bg-[#fff8eb] dark:border-amber-400/20 dark:bg-amber-500/10',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-200/80 px-4 py-3 dark:border-amber-400/15">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
            <ShieldCheck size={14} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-amber-950 dark:text-amber-50">{parsed.title}</p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-100/70">权限响应</p>
          </div>
        </div>
      </div>
      {parsed.bodyLines.length > 0 ? (
        <div className="space-y-2 px-4 py-3 text-sm leading-6 text-amber-950 dark:text-amber-50">
          {parsed.bodyLines.map((line, index) => (
            <p key={`${card.id}-permission-line-${index}`} className="break-words">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {card.actionStatus ? (
        <p className="border-t border-amber-200/80 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/15 dark:text-amber-100">
          {card.actionStatus}
        </p>
      ) : null}
      {card.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-amber-200/80 px-4 py-3 dark:border-amber-400/15">
          {card.actions.flat().map((action) => (
            <Button
              key={`${card.id}-${action.data || action.text}`}
              size="sm"
              variant="secondary"
              onClick={() => onAction(action)}
              disabled={Boolean(card.actionPending || loading)}
              loading={loading}
              className="rounded-full border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-white/[0.08] dark:text-amber-50 dark:hover:bg-white/[0.12]"
            >
              {action.text || action.data}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadChatMessage({
  message,
  pendingBridgeActionId,
  onAction,
}: {
  message: ChatMessage;
  pendingBridgeActionId: string | null;
  onAction: (message: ChatMessage, action: ChatAction) => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isProgress = !isUser && !isSystem && message.kind === 'progress';
  const toolResultCard = !isUser ? toolCallToResultCard(message.toolCall) : null;
  const isToolResult = Boolean(toolResultCard);
  return (
    <div className={cn('flex gap-3 sm:gap-4', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? (
        <div
          className={cn(
            'mt-1 flex shrink-0 items-center justify-center rounded-full text-slate-400 dark:text-slate-500',
            isSystem
              ? 'h-7 w-7 bg-amber-100 text-amber-600 dark:bg-amber-500/12 dark:text-amber-300'
              : isProgress
                ? 'h-6 w-6 bg-[#f0f0f0] dark:bg-white/[0.04]'
                : 'h-8 w-8 bg-[#f5f5f7] dark:bg-white/[0.06]',
          )}
        >
          {isSystem ? <Check size={14} /> : isProgress ? <Circle size={7} className="fill-current" /> : <Bot size={14} />}
        </div>
      ) : null}

      <div
        data-testid="desktop-chat-message"
        data-role={message.role}
        data-kind={message.kind || 'final'}
        data-order={String(message.order)}
        data-timestamp={message.timestamp || ''}
        className={cn(
          'transition-all',
          isUser
            ? 'max-w-[calc(100%-2.25rem)] sm:max-w-[70%]'
            : isToolResult
              ? 'max-w-[calc(100%-2.25rem)] sm:max-w-[80%]'
              : isProgress
                ? 'max-w-[calc(100%-2.25rem)] sm:max-w-[72%]'
                : 'max-w-[calc(100%-2.25rem)] sm:max-w-[78%]',
        )}
      >
        <div
          className={cn(
            'rounded-[20px] px-4 py-3 text-sm',
            isUser
              ? 'chat-user-glass rounded-br-sm text-slate-950 dark:text-slate-50'
              : isSystem
                ? 'rounded-bl-sm border border-amber-200/80 bg-[#fff8eb] text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100'
                : isProgress
                  ? 'rounded-bl-lg bg-[#f5f5f7] text-[13px] leading-6 text-slate-500 dark:bg-white/[0.04] dark:text-slate-400'
                  : 'rounded-bl-sm border border-slate-200 bg-[#fbfbfd] text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-100',
            isToolResult && 'bg-transparent p-0 shadow-none dark:bg-transparent',
          )}
        >
          <div className={cn('mb-2 flex items-center gap-2 text-[10px]', isUser ? 'justify-end text-slate-500 dark:text-white/55' : 'text-slate-400 dark:text-slate-500')}>
            {isSystem ? (
              <span className="tracking-[0.14em] text-amber-600 dark:text-amber-300">系统</span>
            ) : null}
            {isProgress ? (
              <span className="tracking-[0.14em] text-amber-500 dark:text-amber-300">{isToolResult ? '工具' : '过程'}</span>
            ) : null}
            {formatMessageTimestamp(message.timestamp) ? (
              <span data-testid="desktop-chat-message-timestamp">{formatMessageTimestamp(message.timestamp)}</span>
            ) : null}
          </div>
          {!isUser && message.preview && message.previewPlainText ? (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-inherit">
              {message.content}
            </div>
          ) : toolResultCard ? (
            <ToolResultCardView card={toolResultCard} />
          ) : (
            <ChatMarkdown content={message.content} isUser={isUser} />
          )}
          {!isUser && message.actions && message.actions.length > 0 ? (
            <div className="mt-4 space-y-2">
              {message.actions.map((row, rowIndex) => (
                <div key={`${message.id}-actions-${rowIndex}`} className="flex flex-wrap gap-2">
                  {row.map((action) => (
                    <Button
                      key={`${message.id}-${action.data || action.text}`}
                      size="sm"
                      variant={String(action.data || '').includes('deny') ? 'danger' : 'secondary'}
                      onClick={() => onAction(message, action)}
                      disabled={Boolean(message.actionPending || pendingBridgeActionId)}
                      loading={pendingBridgeActionId === message.id}
                      data-testid="desktop-chat-action-button"
                      className="rounded-full"
                    >
                      {action.text || action.data}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {!isUser && message.actionStatus ? (
            <p
              className={cn(
                'mt-3 text-xs',
                message.actionInteractive
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-amber-700 dark:text-amber-200',
              )}
              data-testid="desktop-chat-action-status"
            >
              {message.actionStatus}
            </p>
          ) : null}
          {message.preview ? (
            <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-primary dark:text-primary">实时预览</p>
          ) : null}
        </div>
      </div>

      {isUser ? (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] dark:bg-white/[0.08] sm:h-8 sm:w-8">
          <User size={14} className="text-slate-500 dark:text-slate-300" />
        </div>
      ) : null}
    </div>
  );
}
