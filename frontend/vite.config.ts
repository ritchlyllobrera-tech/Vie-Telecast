import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// In development the multi-user server (npm run server, port 3010) is reached through this proxy.
// The app itself only uses relative URLs (/api, /ws, /uploads), so this is the one place the backend address lives.
const API = 'http://localhost:3010'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from other PCs on the same network
    proxy: {
      '/api': API,
      '/uploads': API,
      '/ws': { target: API, ws: true },
    },
  },
})
