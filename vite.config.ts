import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: { 
      chunkSizeWarningLimit: 2000, 
      rollupOptions: { 
        external: ['intuit-oauth'],
        output: { 
          manualChunks(id) { 
            if (id.includes("node_modules")) { 
              if (id.includes('lucide-react') || id.includes('recharts') || id.includes('motion')) {
                return 'vendor-ui';
              }
              if (id.includes('xlsx')) {
                return 'vendor-xlsx';
              }
              return "vendor"; 
            } 
          } 
        } 
      } 
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
