import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 5188, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } }, preview: { port: 4188, strictPort: true }, build: { chunkSizeWarningLimit: 1100 } });

