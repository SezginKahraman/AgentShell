import net from 'node:net'
import { expect, test } from '@playwright/test'

const liveURL = process.env.AGENTSHELL_LIVE_URL

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close(error => error ? reject(error) : resolve(port))
  })
})

test('live daemon renders managed services, stacks, ports, logs and controls', async ({ page, request }) => {
  test.skip(!liveURL, 'AGENTSHELL_LIVE_URL is required for the live daemon test')

  const suffix = Date.now().toString(36)
  const firstPort = await freePort()
  const secondPort = await freePort()
  const projectResponse = await request.post(`${liveURL}/api/projects`, { data: { name: `Live E2E ${suffix}`, root_path: process.cwd() } })
  expect(projectResponse.ok()).toBeTruthy()
  const project = await projectResponse.json()

  const createCommand = async (name: string, port: number) => {
    const response = await request.post(`${liveURL}/api/commands`, { data: {
      project_id: project.id,
      name,
      command: `python3 -u -m http.server ${port} --bind 127.0.0.1`,
      cwd: process.cwd(),
      kind: 'service',
      concurrency_policy: 'forbid',
      expected_ports: [{ port, name: 'HTTP', protocol: 'http' }],
      tags: ['live-e2e'],
    } })
    expect(response.ok()).toBeTruthy()
    return response.json()
  }

  const firstName = `Live API ${suffix}`
  const secondName = `Live Worker ${suffix}`
  const first = await createCommand(firstName, firstPort)
  const second = await createCommand(secondName, secondPort)
  const stackResponse = await request.post(`${liveURL}/api/stacks`, { data: {
    name: `Live Stack ${suffix}`,
    command_ids: [first.id, second.id],
    start_strategy: 'parallel',
    failure_policy: 'continue',
  } })
  expect(stackResponse.ok()).toBeTruthy()
  const stack = await stackResponse.json()

  try {
    const started = await request.post(`${liveURL}/api/stacks/${stack.id}/start`, { data: {} })
    expect(started.ok()).toBeTruthy()

    await page.goto(liveURL!)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText('Demo data')).toHaveCount(0)
    await expect(page.getByText(firstName, { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Services' }).click()
    const service = page.locator('article.catalog-card').filter({ hasText: firstName })
    await expect(service).toBeVisible()
    await expect(page.getByTestId(`stop-command-${first.id}`)).toBeVisible()
    await expect(page.getByTestId(`restart-command-${first.id}`)).toBeVisible()

    await page.getByRole('button', { name: 'Stacks' }).click()
    const stackCard = page.locator('article.stack-card').filter({ hasText: `Live Stack ${suffix}` })
    await expect(stackCard).toContainText('2/2')
    await expect(page.getByTestId(`stop-stack-${stack.id}`)).toBeVisible()

    await expect.poll(async () => {
      try { return (await request.get(`http://127.0.0.1:${firstPort}/`, { failOnStatusCode: false })).ok() } catch { return false }
    }, { timeout: 5000 }).toBe(true)
    await page.getByRole('button', { name: 'Dashboard' }).click()
    const commandState = await (await request.get(`${liveURL}/api/commands/${first.id}`)).json()
    const runCard = page.getByTestId(`run-card-${commandState.active_run_id}`)
    await runCard.getByRole('button', { name: `Inspect ${firstName}` }).click()
    await page.getByTestId('detail-tab-logs').click()
    await expect(page.getByTestId('log-panel')).toContainText('Serving HTTP')

    await page.getByTestId('run-detail-drawer').getByRole('button', { name: 'Close run details' }).click()
    await page.getByRole('button', { name: 'Ports' }).click()
    await expect(page.getByRole('link', { name: `Open port ${firstPort}` })).toBeVisible()
    await expect(page.getByRole('link', { name: `Open port ${secondPort}` })).toBeVisible()
  } finally {
    await request.post(`${liveURL}/api/stacks/${stack.id}/stop`, { data: {} })
    await request.delete(`${liveURL}/api/stacks/${stack.id}`)
    await request.delete(`${liveURL}/api/commands/${first.id}`)
    await request.delete(`${liveURL}/api/commands/${second.id}`)
    await request.delete(`${liveURL}/api/projects/${project.id}`)
  }
})
