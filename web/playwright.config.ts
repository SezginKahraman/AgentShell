import { defineConfig } from '@playwright/test'

const environment = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const port = Number(environment.process?.env?.AGENTSHELL_E2E_PORT ?? 4173)

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium' },
  webServer: { command: `VITE_DEMO_MODE=true npm run dev -- --host 127.0.0.1 --port ${port}`, port, reuseExistingServer: true },
})
