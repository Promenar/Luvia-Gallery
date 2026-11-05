import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { queryClient } from '@/lib/query';
import { router } from '@/router';
import '@/styles/app.css';

async function enableMocks() {
  // 仅 `vite --mode mock`：在浏览器内拦截 /api，生产构建中此分支被整体移除
  if (import.meta.env.MODE !== 'mock') return;
  const { network } = await import('virtual:msw');
  const { handlers } = await import('@/mocks/handlers');
  network.configure({ handlers, onUnhandledFrame: 'bypass' });
  await network.enable();
}

await enableMocks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
