import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { backupImport } from './vite-plugin-backup.ts';

export default defineConfig({
  plugins: [react(), backupImport()],
  base: './',
  // sql.js ist ein CommonJS/UMD-Paket. Es muss vorgebündelt werden,
  // sonst fehlt im Dev-Server der Default-Export und die Seite bleibt weiß.
  optimizeDeps: { include: ['sql.js'] },
  test: { environment: 'node' },
} as never);
