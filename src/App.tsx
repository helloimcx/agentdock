import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import Layout from '@/components/Layout/Layout';
import Login from '@/pages/Login';
import { useRuntimeFeatureSupport } from '@/app/runtime';
import { rendererUiContributions } from '@/app/ui-contributions';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
      正在加载…
    </div>
  );
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const desktopManaged = useAuthStore((s) => s.desktopManaged);
  const features = useRuntimeFeatureSupport();

  return (
    <Suspense fallback={<RouteLoadingScreen />}>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          {rendererUiContributions.listRoutes().map((route) =>
            route.index ? (
              <Route
                key={route.id}
                index
                element={route.element({ desktopManaged, features })}
              />
            ) : (
              <Route
                key={route.id}
                path={route.path}
                element={route.element({ desktopManaged, features })}
              />
            )
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}
