import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout/Layout';
import { useRuntimeFeatureSupport } from '@/app/runtime';
import { rendererUiContributions } from '@/app/ui-contributions';

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
      正在加载…
    </div>
  );
}

export default function App() {
  const features = useRuntimeFeatureSupport();

  return (
    <Suspense fallback={<RouteLoadingScreen />}>
      <Routes>
        <Route element={<Layout />}>
          {rendererUiContributions.listRoutes().map((route) =>
            route.index ? (
              <Route
                key={route.id}
                index
                element={route.element({ features })}
              />
            ) : (
              <Route
                key={route.id}
                path={route.path}
                element={route.element({ features })}
              />
            )
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
