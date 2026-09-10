import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  server: { headers: {
    // Vite's development-only React refresh preamble is inline; built assets use the stricter _headers policy.
    'Content-Security-Policy': readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('Content-Security-Policy: ')[1].split('\n')[0].replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  } },
  plugins: [react(), cloudflare()],
})