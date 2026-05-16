import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowUp, User, Bot, RotateCw, Circle, WifiOff } from 'lucide-react';
import { Badge, Button, Textarea } from '@/components/ui';
import { getSession, sendMessage, type SessionDetail } from '@/api/sessions';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

export default function SessionChat() {
  const { t } = useTranslation();
  const { project, id } = useParams<{ project: string; id: string }>();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const fetchSession = useCallback(async () => {
    if (!project || !id) return;
    try {
      setLoading(true);
      const data = await getSession(project, id, 200);
      setSession(data);
    } finally {
      setLoading(false);
    }
  }, [project, id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.history]);

  const handleSend = async () => {
    if (!input.trim() || !project || !session) return;
    const msg = input.trim();
    setInput('');
    setSending(true);
    try {
      await sendMessage(project, { session_key: session.session_key, message: msg });
      setTimeout(fetchSession, 1500);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading && !session) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link to="/sessions" className="p-2 rounded-md hover:bg-accent/10 transition-colors">
            <ArrowLeft size={18} className="text-muted-foreground" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[1.4rem] font-semibold text-foreground">{session?.name || id}</h2>
              {session?.live ? (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  <Circle size={5} className="fill-current" /> live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  <WifiOff size={9} /> {t('sessions.offline')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge>{project}</Badge>
              {session?.platform && <Badge variant="info">{session.platform}</Badge>}
              <span className="text-xs text-muted-foreground">{session?.session_key}</span>
            </div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchSession}>
          <RotateCw size={14} /> {t('common.refresh')}
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6">
        {(!session?.history || session.history.length === 0) && (
          <p className="text-center text-sm text-muted-foreground py-12">{t('sessions.noMessages')}</p>
        )}
        <div className="mx-auto max-w-4xl space-y-5">
          {session?.history?.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <div key={i} className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
                {!isUser && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 dark:bg-white/[0.06]">
                    <Bot size={16} className="text-primary" />
                  </div>
                )}
                <div className={cn(
                  'rounded-[20px] px-5 py-3.5 text-sm',
                  isUser
                    ? 'chat-user-glass max-w-[70%] rounded-br-sm text-slate-950 dark:text-slate-50'
                    : 'max-w-[78%] rounded-bl-sm border border-slate-200 bg-[#fbfbfd] text-card-foreground dark:border-white/[0.08] dark:bg-white/[0.04]'
                )}>
                  <ChatMarkdown content={msg.content} isUser={isUser} />
                </div>
                {isUser && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted dark:bg-white/[0.08]">
                    <User size={16} className="text-muted-foreground" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <div className="border-t pt-4">
        {session?.live ? (
          <div className="mx-auto max-w-4xl">
            <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('sessions.messageInput')}
              rows={2}
              className="min-h-[88px] rounded-[22px] border-gray-200 bg-[#fbfbfd] px-4 pb-14 pt-3 text-[15px] leading-6 dark:border-white/[0.08] dark:bg-[rgba(255,255,255,0.04)] sm:min-h-[96px] sm:px-5 sm:pt-4"
              disabled={sending}
            />
            <Button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              size="icon"
              aria-label={t('sessions.messageInput')}
              className="absolute bottom-3 right-3 h-10 w-10 rounded-full bg-primary px-0 text-white shadow-none hover:bg-[#0071e3] disabled:bg-slate-300 disabled:text-white disabled:opacity-100 dark:bg-primary dark:text-white dark:hover:bg-[#2997ff] dark:disabled:bg-white/20 dark:disabled:text-white/55 sm:h-11 sm:w-11"
            >
              {sending ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <ArrowUp size={20} strokeWidth={2.2} />
              )}
            </Button>
          </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground bg-muted rounded-lg">
            <WifiOff size={14} />
            <span>{t('sessions.notLiveHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
