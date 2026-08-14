import { expect, test } from '@playwright/test'

const liveURL = process.env.AGENTSHELL_LIVE_URL
const expectedClient = process.env.AGENTSHELL_EXPECT_MCP_CLIENT

test('live dashboard shows only the actually initialized MCP client', async ({ page }) => {
  test.skip(!liveURL || !expectedClient, 'AGENTSHELL_LIVE_URL and AGENTSHELL_EXPECT_MCP_CLIENT are required')

  await page.goto(liveURL!)
  await expect(page.getByText('Runtime running', { exact: true })).toBeVisible()
  await expect(page.getByText('1 MCP client', { exact: true })).toBeVisible()
  await expect(page.getByText(expectedClient!, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'MCP clients (1)' })).toBeVisible()
  await expect(page.getByText(expectedClient!, { exact: true }).last()).toBeVisible()
})
