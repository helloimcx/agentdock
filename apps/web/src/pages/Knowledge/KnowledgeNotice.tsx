import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui';

export type NoticeTone = 'success' | 'error' | 'warning';

const DEFAULT_SUCCESS_CLASS =
  'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/30 dark:bg-violet-950/20 dark:text-violet-300';

function noticeClassName(tone: NoticeTone, successClass = DEFAULT_SUCCESS_CLASS) {
  if (tone === 'success') {
    return successClass;
  }
  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300';
  }
  return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300';
}

interface KnowledgeNoticeProps {
  notice: { tone: NoticeTone; message: string } | null;
  configReady: boolean;
  loading: boolean;
  unconfiguredTitle: string;
  unconfiguredHint: string;
  successClass?: string;
}

export function KnowledgeNotice({
  notice,
  configReady,
  loading,
  unconfiguredTitle,
  unconfiguredHint,
  successClass,
}: KnowledgeNoticeProps) {
  return (
    <>
      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${noticeClassName(notice.tone, successClass)}`}>
          {notice.message}
        </div>
      )}

      {!configReady && !loading && (
        <div className={`rounded-2xl border px-5 py-4 ${noticeClassName('warning')}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{unconfiguredTitle}</p>
              <p className="mt-1 text-sm opacity-90">{unconfiguredHint}</p>
            </div>
            <Link to="/system">
              <Button variant="secondary">
                <Settings size={14} /> Open System Settings
              </Button>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
