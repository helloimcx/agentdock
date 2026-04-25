import { Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { cn } from '@/lib/utils';
import { getRuntimeProvider, useRuntimeFeatureSupport } from '@/app/runtime';
import { AdvancedDrawer } from '@/components/ui';

export default function Layout() {
  const { pathname } = useLocation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { desktopChat } = useRuntimeFeatureSupport();
  const chatLayout = pathname.startsWith('/chat') && desktopChat;
  const compactDesktopChatLayout =
    chatLayout && getRuntimeProvider() === 'electron';

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden',
        'bg-background'
      )}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-background">
        {compactDesktopChatLayout ? null : <Header onOpenAdvanced={() => setAdvancedOpen(true)} />}
        <main className={cn(
          'flex-1 min-h-0',
          chatLayout ? 'overflow-hidden' : 'overflow-y-auto',
          compactDesktopChatLayout ? 'p-0' : 'p-6',
        )}>
          <div
            className={cn(
              chatLayout && 'h-full min-h-0',
              !compactDesktopChatLayout && 'mx-auto w-full max-w-7xl',
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
      <AdvancedDrawer open={advancedOpen} onClose={() => setAdvancedOpen(false)} />
    </div>
  );
}
