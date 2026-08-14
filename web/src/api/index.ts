import { HttpApi, type AgentShellApi } from './client'
import { demoApi } from './demo'

export interface ApiResult { api: AgentShellApi; fallbackReason?: string }

export async function resolveApi(): Promise<ApiResult> {
  if (import.meta.env.VITE_DEMO_MODE === 'true') return { api: demoApi, fallbackReason: 'Demo mode was enabled explicitly.' }
  const live = new HttpApi()
  try {
    await Promise.race([live.health(), new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), 1400))])
    return { api: live }
  } catch (error) {
    return { api: demoApi, fallbackReason: error instanceof Error ? error.message : 'API unavailable' }
  }
}
