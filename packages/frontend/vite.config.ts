import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // VITE_BACKEND_URL may include /api suffix (e.g. https://host.com/api)
  // The proxy target must be the origin only; the /api path is already in axios baseURL.
  const raw = env.VITE_BACKEND_URL || 'http://localhost:3001';
  const backendOrigin = raw.replace(/\/api\/?$/, '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: backendOrigin,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
  };
});
