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
	    const started = await request.post(`${liveURL}/api/stacks/${stack.id}/start`, { data: { command_ids: [first.id] } })
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
	await service.click()
	await expect(page.getByTestId('command-detail-drawer')).toContainText(`:${firstPort}`)
	await page.getByTestId('command-tab-runs').click()
	await expect(page.getByTestId('command-detail-drawer')).toContainText(`http.server ${firstPort}`)
	await page.getByTestId('command-detail-drawer').getByRole('button', { name: 'Close launcher details' }).click()

    await page.getByRole('button', { name: 'Stacks' }).click()
    const stackCard = page.locator('article.stack-card').filter({ hasText: `Live Stack ${suffix}` })
	    await expect(stackCard).toContainText('1/2')
	    await stackCard.click()
	    const stackDrawer = page.getByTestId('stack-detail-drawer')
	    await expect(stackDrawer.locator('label').filter({ hasText: firstName }).getByRole('checkbox')).toBeDisabled()
	    await stackDrawer.locator('label').filter({ hasText: secondName }).getByRole('checkbox').check()
	    await page.getByTestId(`start-selected-stack-${stack.id}`).click()
	    await expect.poll(async () => (await (await request.get(`${liveURL}/api/stacks/${stack.id}`)).json()).running_count).toBe(2)
	    await stackDrawer.getByRole('button', { name: 'Close stack details' }).click()
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
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Logs', exact: true }).click()
    await expect(page.getByTestId('logs-page').getByRole('tab', { name: `Live E2E ${suffix}`, exact: true })).toBeVisible()
    await expect(page.getByTestId('logs-page').getByRole('tab', { name: new RegExp(`:${firstPort}`) })).toBeVisible()
    await expect(page.getByTestId('live-log-terminal')).toContainText('Serving HTTP')
	await expect(page.getByTestId('logs-page').getByRole('tab', { name: 'Project root', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Ports' }).click()
    await expect(page.getByRole('link', { name: `Open port ${firstPort}` })).toBeVisible()
    await expect(page.getByRole('link', { name: `Open port ${secondPort}` })).toBeVisible()
  } finally {
    await request.post(`${liveURL}/api/stacks/${stack.id}/stop`, { data: {} })
		await expect.poll(async () => {
			const response = await request.get(`${liveURL}/api/stacks/${stack.id}`, { failOnStatusCode: false })
			return response.ok() ? (await response.json()).status : 'missing'
		}, { timeout: 10_000 }).toBe('stopped')
    await request.delete(`${liveURL}/api/stacks/${stack.id}`)
    await request.delete(`${liveURL}/api/commands/${first.id}`)
    await request.delete(`${liveURL}/api/commands/${second.id}`)
    await request.delete(`${liveURL}/api/projects/${project.id}`)
  }
})

test('live daemon keeps detached start and stop actions on one external launcher', async ({ page, request }) => {
	test.skip(!liveURL, 'AGENTSHELL_LIVE_URL is required for the live daemon test')
	const suffix = Date.now().toString(36)
	const port = await freePort()
	const pidPath = `/tmp/agentshell-external-${suffix}.pid`
	const logPath = `/tmp/agentshell-external-${suffix}.log`
	const detachedStart = `python3 -c 'import subprocess; p=subprocess.Popen(["python3","-u","-m","http.server","${port}","--bind","127.0.0.1"],stdout=open("${logPath}","ab"),stderr=subprocess.STDOUT,start_new_session=True); open("${pidPath}","w").write(str(p.pid))'`
	const detachedStop = `if test -f "${pidPath}"; then kill "$(cat "${pidPath}")" 2>/dev/null || true; fi; rm -f "${pidPath}" "${logPath}"`
	const response = await request.post(`${liveURL}/api/commands`, { data: {
		name: `External lifecycle ${suffix}`,
		command: detachedStart,
		stop_command: detachedStop,
		cwd: process.cwd(),
		kind: 'service',
		lifecycle_mode: 'external',
		concurrency_policy: 'forbid',
		expected_ports: [{ port, name: 'Detached HTTP', service: 'http' }],
		tags: ['live-e2e'],
	} })
	expect(response.ok()).toBeTruthy()
	const command = await response.json()
	try {
		expect((await request.post(`${liveURL}/api/commands/${command.id}/start`, { data: {} })).ok()).toBeTruthy()
		await expect.poll(async () => {
			const view = await (await request.get(`${liveURL}/api/commands/${command.id}`)).json()
			return `${view.status}:${view.port_verifications?.[0]?.status}`
		}, { timeout: 15_000 }).toBe('external:verified')
		const ports = await (await request.get(`${liveURL}/api/ports`)).json()
		expect(ports).toEqual(expect.arrayContaining([expect.objectContaining({ port, status: 'external_verified', attribution: 'external', confidence: 'high' })]))
		await page.goto(liveURL!)
		await page.getByRole('button', { name: 'Services' }).click()
		const card = page.getByTestId(`command-card-${command.id}`)
		await expect(card).toContainText('verified')
		await page.getByTestId(`stop-command-${command.id}`).click()
		await expect.poll(async () => {
			const view = await (await request.get(`${liveURL}/api/commands/${command.id}`)).json()
			return `${view.status}:${view.port_verifications?.[0]?.status}`
		}, { timeout: 15_000 }).toBe('stopped:stopped')
		const afterStopPorts = await (await request.get(`${liveURL}/api/ports`)).json()
		expect(afterStopPorts.some((item: { port: number }) => item.port === port)).toBeFalsy()
		await card.click()
		await page.getByTestId('command-tab-runs').click()
		await expect(page.getByTestId('command-detail-drawer')).toContainText('stop ·')
	} finally {
		const current = await request.get(`${liveURL}/api/commands/${command.id}`, { failOnStatusCode: false })
		if (current.ok() && (await current.json()).can_stop) await request.post(`${liveURL}/api/commands/${command.id}/stop`, { data: {} })
		await request.delete(`${liveURL}/api/commands/${command.id}`)
	}
})
