import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { cn } from '@/lib/utils';
import { getRuntimeProvider, useRuntimeFeatureSupport } from '@/app/runtime';

export default function Layout() {
  const { pathname } = useLocation();
  const { desktopChat } = useRuntimeFeatureSupport();
  const isChatRoute = pathname.startsWith('/chat');
  const chatLayout = pathname.startsWith('/chat') && desktopChat;
  const compactDesktopChatLayout =
    chatLayout && getRuntimeProvider() === 'electron';

  return (
    <div
      className={cn(
        'flex h-[100dvh] overflow-hidden',
        'bg-background/60 backdrop-blur-2xl'
      )}
    >
      <div
        className="fixed left-0 right-0 top-0 z-50 hidden h-8 [-webkit-app-region:drag] md:block"
        aria-hidden="true"
      />
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-background/45 backdrop-blur-2xl">
        <main className={cn(
          'flex-1 min-h-0',
          chatLayout ? 'overflow-hidden' : 'overflow-y-auto',
          compactDesktopChatLayout ? 'p-0' : isChatRoute ? 'p-4 pb-4 sm:p-6 sm:pb-6' : 'p-4 pb-24 sm:p-6 sm:pb-6',
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
    </div>
  );
}
