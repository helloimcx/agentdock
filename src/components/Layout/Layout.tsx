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
  const compactDesktopChatLayout =
    pathname.startsWith('/chat') && desktopChat && getRuntimeProvider() === 'electron';

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden',
        'bg-[radial-gradient(circle_at_top_left,#f3e8ff_0,#faf5ff_34%,#ffffff_78%)]',
        'dark:bg-[radial-gradient(circle_at_top_left,#2e1065_0,#10051f_36%,#05020a_82%)]'
      )}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {compactDesktopChatLayout ? null : <Header onOpenAdvanced={() => setAdvancedOpen(true)} />}
        <main className={cn(
          'flex-1',
          compactDesktopChatLayout ? 'overflow-hidden p-0' : 'overflow-y-auto p-6',
        )}>
          <div className={cn(!compactDesktopChatLayout && 'mx-auto w-full max-w-7xl')}>
            <Outlet />
          </div>
        </main>
      </div>
      <AdvancedDrawer open={advancedOpen} onClose={() => setAdvancedOpen(false)} />
    </div>
  );
}
