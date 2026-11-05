/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { msw } from 'msw/vite';
import { fileURLToPath } from 'node:url';

// 开发时把 /api 代理到本机 api 进程（默认 3001）；--mode mock 时由 MSW 在浏览器内拦截，不需要后端。
const apiTarget = process.env.LUVIA_API ?? 'http://127.0.0.1:3001';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'mock' ? [msw()] : [])],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: { target: 'es2023', sourcemap: true },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
}));
