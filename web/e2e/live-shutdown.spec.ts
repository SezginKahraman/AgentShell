import { expect, test } from '@playwright/test'

const liveURL = process.env.AGENTSHELL_LIVE_URL
const allowShutdown = process.env.AGENTSHELL_LIVE_SHUTDOWN === 'true'

test('live dashboard performs a confirmed controlled Runtime shutdown', async ({ page }) => {
  test.skip(!liveURL || !allowShutdown, 'AGENTSHELL_LIVE_URL and AGENTSHELL_LIVE_SHUTDOWN=true are required')

  await page.goto(liveURL!)
  await expect(page.getByText('Runtime running', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AgentShell Runtime' })).toBeVisible()
  await page.getByTestId('open-shutdown').click()
  await expect(page.getByRole('dialog', { name: 'Stop AgentShell?' })).toContainText('Shutdown E2E')
  await page.getByTestId('confirm-shutdown').click()
  await expect(page.getByRole('heading', { name: 'AgentShell stopped' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('This page no longer reports a live connection.')).toBeVisible()
})
