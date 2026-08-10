import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // exposes on 0.0.0.0 so Docker can reach it
    port: 5173
  }
})
