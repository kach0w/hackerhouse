import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Lets an ngrok tunnel (random subdomain each run) reach the dev server —
    // Vite blocks unrecognized Host headers by default.
    allowedHosts: ['.ngrok-free.app'],
  },
})
