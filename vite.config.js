import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// build 2026
export default defineConfig({
export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  define: {
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
})
