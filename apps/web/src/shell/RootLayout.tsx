import { Outlet } from '@tanstack/react-router';
import { Toaster } from '@/components/kit/sonner';
import { ThemeProvider } from '@/theme/ThemeProvider';

export function RootLayout() {
  return (
    <ThemeProvider>
      <Outlet />
      <Toaster position="bottom-center" />
    </ThemeProvider>
  );
}
