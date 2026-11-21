import { type Page, expect, test } from '@playwright/test';

/**
 * The console in a browser, against its own API with an empty data folder and no Mac helper
 * (see playwright.config.ts). Desktop and phone share that data, so each step works whether the
 * PIN or the project already exists.
 */
const PIN = '135790';

/** Opens the console: sets the PIN on the first run, otherwise types it. */
async function unlock(page: Page): Promise<void> {
	await page.goto('/');
	const first = page.getByText('First time: choose a 6-digit console PIN.');
	const again = page.getByText(/Enter your 6-digit console PIN/);
	await expect(first.or(again)).toBeVisible();
	if (await first.isVisible()) {
		await page.keyboard.type(PIN);
		await expect(page.getByText(/again/i).first()).toBeVisible();
	}
	await page.keyboard.type(PIN);
	await expect(page.getByRole('heading', { name: 'All projects' })).toBeVisible();
}

/**
 * Sample GitHub answers for Connect and the branch list: this test runs without the Mac helper and
 * without a GitHub sign-in, and never uses a real token.
 */
async function sampleGithub(page: Page): Promise<void> {
	const at = new Date().toISOString();
	const job = {
		id: 'github-sample',
		kind: 'github',
		label: 'Connect to GitHub',
		status: 'passed',
		startedAt: at,
		finishedAt: at,
		exitCode: 0,
		lines: [],
	};
	const answers: [string, unknown][] = [
		['**/api/local/github/login', job],
		['**/api/local/jobs/github-sample**', job],
		[
			'**/api/local/github/check**',
			{
				installed: true,
				signedIn: true,
				account: 'test-account',
				repository: 'Kaizer-Systems/saha-textile',
				fullName: 'Kaizer-Systems/saha-textile',
				reachable: true,
				message: '',
			},
		],
		[
			'**/api/repository-branches**',
			{
				defaultBranch: 'main',
				current: null,
				note: '',
				branches: ['main', 'staging', 'dev'].map((name) => ({ name, onGitHub: true, onThisComputer: false })),
			},
		],
		['**/api/repository-file', { state: 'ok', readAt: at, data: { found: false, menus: [] } }],
	];
	for (const [url, body] of answers)
		await page.route(url, (route) => {
			const origin = route.request().headers()['origin'] ?? '*';
			const headers = {
				'access-control-allow-origin': origin,
				'access-control-allow-credentials': 'true',
				'access-control-allow-headers': 'content-type, x-console-session',
				'access-control-allow-methods': 'GET, POST, OPTIONS',
			};
			if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
			return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
		});
}

test.describe.configure({ mode: 'serial' });

test('the PIN is typed straight into the six boxes; a wrong one is refused; Lock closes the console', async ({
	page,
}) => {
	await unlock(page);
	await page.getByRole('button', { name: /Lock/ }).first().click();
	await expect(page.getByText(/Enter your 6-digit console PIN/)).toBeVisible();
	await page.keyboard.type('000000');
	await expect(page.getByText(/Wrong PIN/i)).toBeVisible();
	await page.keyboard.type(PIN);
	await expect(page.getByRole('heading', { name: 'All projects' })).toBeVisible();
});

test('the wizard adds a project with a GitHub repository and lands on its Connections', async ({ page }, info) => {
	const name = `Browser test ${info.project.name}`;
	await sampleGithub(page);
	await unlock(page);
	await page
		.getByRole('button', { name: /Add a project/ })
		.first()
		.click();
	await page.getByLabel('Project').fill(name);
	await page.getByPlaceholder('Clients, Personal…').fill('Tests');
	await page.getByRole('button', { name: /^Next/ }).click();
	await page.getByRole('radio', { name: /GitHub pull requests/ }).click();
	await page.getByPlaceholder('Kaizer-Systems/shop-web').fill('Kaizer-Systems/saha-textile');
	await page.getByPlaceholder('storefront, API, admin…').fill('monorepo');
	await page.getByRole('button', { name: /Add repository/ }).click();
	await expect(page.getByRole('cell', { name: /Kaizer-Systems\/saha-textile/ })).toBeVisible();
	const next = page.getByRole('button', { name: /^Next/ });
	// Connect always opens its terminal; with the sample answers it signs in at once.
	await page.getByRole('button', { name: 'Connect', exact: true }).click();
	await expect(page.getByText('Close the terminal? [Y/n]')).toBeVisible();
	await page.keyboard.press('y');
	await expect(page.getByText('connected as test-account')).toBeVisible();
	await next.click();
	// Each environment gets a branch: Local and Production the default branch, Staging staging.
	await expect(page.getByLabel('Branch for Staging')).toHaveValue('staging');
	await expect(page.getByLabel('Branch for Production')).toHaveValue('main');
	// Environments: Next waits until every environment has a domain (owner, 20 Nov).
	await expect(next).toBeDisabled();
	await expect(page.getByText('Give Staging at least one domain', { exact: false })).toBeVisible();
	const domains = page.getByPlaceholder('shop.example.com, admin.example.com');
	await domains.nth(1).fill('staging.example.com');
	await domains.nth(2).fill('example.com, www.example.com');
	await next.click();
	// Cloud platforms: the cloud Staging and Production run on is ticked and stays ticked.
	await expect(page.getByText('Staging and Production run here')).toBeVisible();
	await page.getByRole('checkbox', { name: /DigitalOcean/ }).click();
	await expect(page.getByText(/Move them on Environments first/)).toBeVisible();
	await next.click();
	// Edge and DNS: Cloudflare needs the domain it holds.
	await expect(next).toBeDisabled();
	await page.getByPlaceholder('example.com', { exact: true }).fill('example.com');
	await next.click();
	// Secrets: each environment chooses, here no manager.
	await expect(next).toBeDisabled();
	for (const chip of await page.getByRole('button', { name: 'no manager' }).all()) await chip.click();
	await next.click();
	// Project menus: optional; Search engines is ticked so its screen can be tested below.
	await page.getByRole('checkbox', { name: /Search engines/ }).click();
	await page.getByRole('checkbox', { name: /Client versions/ }).click();
	await page.getByRole('checkbox', { name: /Messages/ }).click();
	await next.click();
	await expect(page.getByRole('heading', { name: /Add a project · Done/i })).toBeVisible();
	await page.getByRole('button', { name: 'Add project', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
	await expect(page.getByText('not connected').first()).toBeVisible();
	await expect(page.getByText('not written yet')).toBeVisible();
	await page.goto('/console/projects');
	await expect(page.getByRole('heading', { name })).toBeVisible();
});

test('Live deploy without the Mac helper says so and shows what to do', async ({ page }, info) => {
	const id = `browser-test-${info.project.name}`;
	await unlock(page);
	await page.goto(`/p/${id}/r/saha-textile/deploy`);
	await expect(page.getByText(/The Mac helper is not answering/).first()).toBeVisible();
	await expect(page.getByText('What to do')).toBeVisible();
	await expect(page.getByText('pnpm console:up').first()).toBeVisible();
});

test('Watch › Alerts lists the local rules', async ({ page }, info) => {
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/alerts?tab=rules`);
	for (const rule of ['Start-up disk filling', 'A container stopped', 'Mac helper silent', 'Errors rising'])
		await expect(page.getByText(rule)).toBeVisible();
});

/** Sample answers for a server environment's deploy view and its Infisical names (names only, no values). */
async function sampleServerDeploy(page: Page, environment: string): Promise<void> {
	const at = new Date().toISOString();
	const target = environment === 'production' ? 'production' : 'staging';
	const view = {
		state: 'ok',
		readAt: at,
		data: {
			environment,
			target,
			branch: target === 'production' ? 'main' : 'staging',
			setup: { environmentExists: true, missingVariables: [], missingSecrets: [], workflowOnBranch: true },
			run: null,
			recent: [],
		},
	};
	const row = (name: string, state: string, required = true, mayDeployBlank = false) => ({
		name,
		expected: true,
		devOnly: false,
		optional: false,
		writable: true,
		requiredForRelease: required,
		mayDeployBlank,
		state,
	});
	const secrets = {
		at,
		tier: target,
		project: `saha-textile-${target}`,
		environment: target === 'production' ? 'prod' : 'staging',
		folder: '/',
		folders: [
			{
				folder: 'api',
				rows: [
					row('CCAVENUE_WORKING_KEY', 'empty', false),
					row('COOKIE_DOMAIN', 'set'),
					row('MONGODB_PASSWORD', 'empty'),
					row('MSG91_AUTH_KEY', 'empty', true, true),
					row('SPACES_BUCKET', 'empty', true, true),
					row('SPACES_KEY', 'empty', true, true),
					row('SPACES_SECRET', 'empty', true, true),
				],
			},
		],
		errors: [],
	};
	for (const [url, body] of [
		[`**/server-deploy/${environment}`, view],
		['**/api/local/secrets?**', secrets],
	] as const)
		await page.route(url, (route) => {
			const origin = route.request().headers()['origin'] ?? '*';
			const headers = {
				'access-control-allow-origin': origin,
				'access-control-allow-credentials': 'true',
				'access-control-allow-headers': 'content-type, x-console-session',
				'access-control-allow-methods': 'GET, POST, OPTIONS',
			};
			if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
			return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
		});
}

test('a server deploy reads blank values on opening and can allow them (screen 12)', async ({ page }, info) => {
	await sampleServerDeploy(page, 'staging');
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/deploy?tab=staging`);
	await expect(page.getByText('locked · change it in Project settings › Repositories')).toBeVisible();
	// Payment keys never stop a deploy, so they are not counted.
	await expect(page.getByText('5 required values are blank in saha-textile-staging · staging')).toBeVisible();
	await page.getByRole('button', { name: 'Allow all 4' }).click();
	for (const n of ['MSG91_AUTH_KEY', 'SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET'])
		await expect(page.getByText(`--allow-blank ${n}`, { exact: true })).toBeVisible();
	await expect(
		page.getByText(/sign-in codes and texts are not sent \(MSG91\); photo uploads are off \(Spaces\)/),
	).toBeVisible();
	// The Spaces keys go together: ✕ on one puts all three back; picking one brings all three.
	await page.getByRole('button', { name: 'SPACES_KEY ✕' }).click();
	await expect(page.getByRole('button', { name: 'SPACES_SECRET ✕' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'MSG91_AUTH_KEY ✕' })).toBeVisible();
	await page.getByLabel('Search blank values to allow').click();
	await expect(page.getByText('cannot be blank: the database will not start')).toBeVisible();
	await expect(page.getByRole('option', { name: /CCAVENUE/ })).toHaveCount(0);
	await page.getByRole('option', { name: /SPACES_BUCKET/ }).click();
	for (const n of ['SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET'])
		await expect(page.getByRole('button', { name: `${n} ✕` })).toBeVisible();
});

test('Search engines shows the sitemap check and the shop’s missing pages (screen 5)', async ({ page }, info) => {
	const at = new Date().toISOString();
	const result = {
		origin: 'https://local.saha-textile.localhost:8443',
		sitemap: '/sitemap.xml',
		at,
		listed: 4,
		checked: 4,
		ok: 2,
		redirects: 1,
		notFound: 1,
		other: 0,
		failures: [
			{ path: '/collections/silk-old', status: 404 },
			{ path: '/sale', status: 301 },
		],
		paths: ['/', '/collections/silk', '/collections/silk-old', '/sale'],
		note: '',
	};
	const job = {
		id: 'seo-sample',
		kind: 'seo',
		label: 'Check the sitemap of this computer',
		status: 'passed',
		startedAt: at,
		finishedAt: at,
		exitCode: 0,
		lines: [{ seq: 1, stream: 'out', text: '', event: { result } }],
	};
	const answers: [string, unknown][] = [
		['**/api/local/jobs', [job]],
		['**/api/local/jobs/seo-sample**', job],
		[
			'**/api/local/not-found**',
			{
				source: 'edge',
				since: at,
				total: 30,
				paths: [
					{ route: '/collections/silk-old', count: 21, from: ['google.com'], lastAt: at },
					{ route: '/product/banarasi-red', count: 9, from: ['instagram.com', 'this site'], lastAt: at },
				],
			},
		],
	];
	for (const [url, body] of answers)
		await page.route(url, (route) => {
			const origin = route.request().headers()['origin'] ?? '*';
			const headers = {
				'access-control-allow-origin': origin,
				'access-control-allow-credentials': 'true',
				'access-control-allow-headers': 'content-type, x-console-session',
				'access-control-allow-methods': 'GET, POST, OPTIONS',
			};
			if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
			return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
		});
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/seo`);
	await expect(page.getByText('2 / 4')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Check the sitemap' })).toBeEnabled();
	await expect(page.getByRole('cell', { name: '/collections/silk-old' }).first()).toBeVisible();
	await expect(page.getByRole('cell', { name: 'google.com' })).toBeVisible();
	await expect(page.getByRole('cell', { name: 'instagram.com, this site' })).toBeVisible();
	await expect(page.getByText('needs the Search Console key')).toBeVisible();
});

test('Client versions lists the builds still calling, newest first (screen 4)', async ({ page }, info) => {
	const at = new Date().toISOString();
	await page.route('**/api/local/client-builds**', (route) => {
		const origin = route.request().headers()['origin'] ?? '*';
		const headers = {
			'access-control-allow-origin': origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'content-type, x-console-session',
			'access-control-allow-methods': 'GET, POST, OPTIONS',
		};
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers,
			body: JSON.stringify({
				source: 'edge',
				since: at,
				apps: [
					{
						service: 'storefront',
						builds: [
							{
								build: 'ea27a021',
								requests: 12480,
								installed: 3869,
								lastHour: 610,
								firstAt: at,
								lastAt: at,
							},
							{ build: '471b5c40', requests: 910, installed: 582, lastHour: 12, firstAt: at, lastAt: at },
						],
					},
				],
			}),
		});
	});
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/clients`);
	await expect(page.getByText('ea27a021 (newest)')).toBeVisible();
	await expect(page.getByRole('cell', { name: '31%' })).toBeVisible();
	await expect(page.getByRole('cell', { name: '64%' })).toBeVisible();
});

test('Job queues and Messages read the shop API’s operations address (screens 8 and 3)', async ({ page }, info) => {
	const at = new Date().toISOString();
	const answer = async (url: string, data: unknown) =>
		page.route(url, (route) => {
			const origin = route.request().headers()['origin'] ?? '*';
			const headers = {
				'access-control-allow-origin': origin,
				'access-control-allow-credentials': 'true',
				'access-control-allow-headers': 'content-type, x-console-session',
				'access-control-allow-methods': 'GET, POST, OPTIONS',
			};
			if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers,
				body: JSON.stringify({ state: 'ok', readAt: at, data }),
			});
		});
	await answer('**/ops/local/jobs', {
		at,
		queues: [{ queue: 'saha-textile-media', waiting: 0, active: 1, delayed: 0, failed: 2, completed: 40 }],
	});
	await answer('**/ops/local/messages', {
		at,
		since: at,
		channels: [{ channel: 'sms', total: 8, sent: 5, delivered: 1, failed: 1, suppressed: 1, queued: 0 }],
		recent: [{ at, channel: 'sms', category: 'transactional', template: 'sign-in-code', status: 'sent' }],
	});
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/queues`);
	await expect(page.getByRole('cell', { name: 'saha-textile-media' })).toBeVisible();
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/messages`);
	await expect(page.getByText('75% sent or delivered · 1 failed · 1 held back')).toBeVisible();
	await expect(page.getByRole('cell', { name: 'sign-in-code' })).toBeVisible();
});

/** A made-up DigitalOcean account for the create steps: no real key or account is used. */
const sampleCatalog = {
	regions: [
		{ slug: 'blr1', name: 'Bangalore 1', available: true, sizes: [], features: [] },
		{ slug: 'sfo1', name: 'San Francisco 1', available: false, sizes: [], features: [] },
	],
	sizes: [
		['s-2vcpu-4gb', 'regular', 4096, 2, 80, 24],
		['s-4vcpu-8gb', 'regular', 8192, 4, 160, 48],
		['s-2vcpu-4gb-amd', 'amd', 4096, 2, 80, 28],
		['s5-2vcpu-4gb-50gb', 'v5shared', 4096, 2, 50, 26],
		['s5-4vcpu-8gb-50gb', 'v5shared', 8192, 4, 50, 50],
		['g-2vcpu-8gb', 'general', 8192, 2, 25, 63],
	].map(([slug, family, memoryMb, vcpus, diskGb, price]) => ({
		slug,
		description: String(family),
		family,
		memoryMb,
		vcpus,
		diskGb,
		transferTb: 4,
		priceMonthly: price,
		priceHourly: Number(price) / 672,
		regions: ['blr1'],
		available: true,
	})),
	images: [
		['ubuntu-26-04-x64', 'Ubuntu', '26.04 (LTS) x64', 'os', '2026-04-30'],
		['ubuntu-24-04-x64', 'Ubuntu', '24.04 (LTS) x64', 'os', '2024-04-30'],
		['debian-13-x64', 'Debian', '13 x64', 'os', '2025-08-10'],
		['docker-20-04', 'Ubuntu', 'Docker on Ubuntu', 'app', '2025-01-01'],
		[null, 'Ubuntu', 'before-upgrade', 'snapshot', '2026-11-01'],
	].map(([slug, distribution, name, kind, made], n) => ({
		id: n + 1,
		slug,
		name,
		distribution,
		kind,
		regions: ['blr1'],
		minDiskGb: 10,
		sizeGb: kind === 'snapshot' ? 3.2 : null,
		createdAt: `${made}T00:00:00Z`,
		of: null,
	})),
	sshKeys: [{ id: 7, name: 'example key', fingerprint: 'aa:bb:cc' }],
	vpcs: [],
	projects: [{ id: 'p1', name: 'first-project', isDefault: true }],
	missing: [],
};

test('DigitalOcean’s create steps read live lists, price the droplet and show the request', async ({ page }, info) => {
	await page.route('**/cloud/*/catalog', async (route) => {
		const origin = route.request().headers()['origin'] ?? '*';
		const headers = {
			'access-control-allow-origin': origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'content-type, x-console-session',
		};
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		// Slow on purpose: the screen must say it is reading, never sit blank (owner, 21 Nov).
		await new Promise((r) => setTimeout(r, 1200));
		const body = { state: 'ok', readAt: new Date().toISOString(), data: sampleCatalog };
		return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
	});
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/droplets?tab=region`);
	await expect(page.getByRole('status').filter({ hasText: 'Reading DigitalOcean…' })).toBeVisible();
	await expect(page.getByText('New droplet for staging')).toBeVisible();
	await expect(page.getByRole('radio', { name: /Bangalore 1/ })).toHaveAttribute('aria-checked', 'true');
	const cost = page.locator('.do-cost b');
	await expect(cost).toHaveText('$24');

	await page.getByRole('button', { name: 'Next: Image ›' }).click();
	await page.getByRole('radio', { name: /^Debian/ }).click();
	await expect(page.locator('.do-sum')).toContainText('Debian 13 x64');
	await page.getByRole('radio', { name: /^Ubuntu/ }).click();
	await page.getByRole('radio', { name: /26\.04 \(LTS\) x64 · our servers use this/ }).click();
	await expect(page.locator('.do-sum')).toContainText('Ubuntu 26.04 (LTS) x64');

	await page.getByRole('button', { name: 'Next: Size ›' }).click();
	await page.getByRole('radio', { name: /\$48/ }).click();
	await expect(cost).toHaveText('$48');
	// The sliders choose among DigitalOcean's v5 sizes, the cheapest with at least what is set.
	await page.getByRole('tab', { name: 'Build your own (sliders)' }).click();
	await expect(page.getByText(/2 combinations in\s+blr1/)).toBeVisible();
	await page.getByRole('slider', { name: 'vCPU' }).focus();
	await page.keyboard.press('ArrowLeft');
	await page.getByRole('slider', { name: 'Memory' }).focus();
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.do-sum pre')).toContainText('"size": "s5-2vcpu-4gb-50gb"');
	await expect(cost).toHaveText('$26');

	await page.getByRole('button', { name: 'Next: Storage and backups ›' }).click();
	await page.getByRole('radio', { name: /^Weekly/ }).click();
	await expect(cost).toHaveText('$31.20');
	await expect(page.locator('.do-sum pre')).toContainText('"plan": "weekly"');

	await page.getByRole('button', { name: 'Next: Sign-in ›' }).click();
	await page.getByRole('checkbox', { name: /example key/ }).click();
	await expect(page.locator('.do-sum')).toContainText('SSH key example key');

	await page.getByRole('button', { name: 'Next: Network and extras ›' }).click();
	await expect(page.getByText("443 from Cloudflare's ranges only")).toBeVisible();
	await page.getByRole('button', { name: 'Next: Name and confirm ›' }).click();
	await expect(page.getByText('Not ready to create:')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Create staging droplet/ })).toBeEnabled();
	await expect(page.locator('.do-sum pre')).toContainText(`"name": "browser-test-${info.project.name}-staging"`);
	await expect(page.locator('.do-sum pre')).toContainText('"user_data": "(docker/production/first-boot.yaml');
});

test('Create asks for the typed name, the admin password and the PIN, then follows each step', async ({
	page,
}, info) => {
	const base = `browser-test-${info.project.name}`;
	const at = new Date().toISOString();
	const steps = (upto: number) =>
		[
			['tunnel', 'Cloudflare tunnel for the server'],
			['first-boot', 'First-boot file filled in on this Mac'],
			['droplet', 'Request accepted by DigitalOcean'],
			['active', 'Server built and switched on'],
		].map(([key, label], n) => ({
			key,
			label,
			detail: n < upto ? 'done (sample)' : '',
			state: n < upto ? 'done' : n === upto ? 'running' : 'queued',
			ms: n < upto ? 1000 : null,
		}));
	const job = (upto: number, state: string) => ({
		id: 'job-sample',
		kind: 'create',
		environment: 'staging',
		name: `${base}-staging`,
		state,
		startedAt: at,
		finishedAt: state === 'running' ? null : at,
		steps: steps(upto),
		dropletId: 42,
		ipv4: '203.0.113.9',
		ipv6: null,
		privateIp: null,
		monthly: 24,
		hourly: 0.036,
		error: null,
	});
	let created: Record<string, unknown> | null = null;
	let reads = 0;
	const cors = (origin: string) => ({
		'access-control-allow-origin': origin,
		'access-control-allow-credentials': 'true',
		'access-control-allow-headers': 'content-type, x-console-session',
		'access-control-allow-methods': 'GET, POST, OPTIONS',
	});
	await page.route('**/cloud/*/catalog', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: cors(route.request().headers()['origin'] ?? '*'),
			body: JSON.stringify({ state: 'ok', readAt: at, data: sampleCatalog }),
		}),
	);
	await page.route('**/droplet-jobs/**', (route) => {
		const headers = cors(route.request().headers()['origin'] ?? '*');
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		if (route.request().method() === 'POST') {
			created = route.request().postDataJSON() as Record<string, unknown>;
			return route.fulfill({
				status: 202,
				contentType: 'application/json',
				headers,
				body: JSON.stringify(job(0, 'running')),
			});
		}
		reads += 1;
		const body = reads < 2 ? job(2, 'running') : job(4, 'done');
		return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
	});
	await unlock(page);
	await page.goto(`/p/${base}/r/saha-textile/droplets?tab=auth`);
	await page.getByRole('checkbox', { name: /example key/ }).click();
	await page.getByRole('link', { name: /7\s*Name and confirm/ }).click();
	await page.getByRole('button', { name: /Create staging droplet/ }).click();
	const box = page.getByRole('dialog', { name: `Create ${base}-staging` });
	await expect(box).toBeVisible();
	const go = box.getByRole('button', { name: /Create and pay/ });
	await expect(box.getByText('Type staging to confirm.')).toBeVisible();
	await box.getByLabel('Type staging to confirm').fill('staging');
	await box.getByLabel('Admin password for the Recovery Console').fill('example only words');
	await box.getByLabel('Admin password again').fill('example only words');
	await expect(box.getByText('Add at least one person who may sign in over SSH.')).toBeVisible();
	await box.getByLabel('Add a person who may sign in over SSH').fill('owner@example.com');
	await page.keyboard.press('Enter');
	await expect(box.getByText('Type your console PIN.')).toBeVisible();
	await expect(go).toBeDisabled();
	await box.getByLabel('PIN digit 1 of 6').click();
	await page.keyboard.type(PIN);
	await expect(go).toBeEnabled();
	await go.click();
	await expect(page.getByText('Each step, as it happens')).toBeVisible();
	await expect(page.getByText(`${base}-staging is ready`)).toBeVisible();
	expect(created).toMatchObject({
		confirm: 'staging',
		pin: PIN,
		sshEmails: ['owner@example.com'],
		draft: { environment: 'staging', sshKeyIds: [7] },
	});
});

test('a DigitalOcean product screen lists, opens its create form with the price, and sends it with the PIN', async ({
	page,
}, info) => {
	const base = `browser-test-${info.project.name}`;
	const at = new Date().toISOString();
	const field = (key: string, label: string, type: string, value: unknown) => ({
		key,
		label,
		type,
		options: [],
		value,
		help: '',
		required: true,
		min: null,
		max: null,
		readOnly: false,
	});
	const list = {
		type: 'view',
		picker: null,
		view: {
			head: null,
			stats: [{ label: 'Volumes', value: '1', sub: '' }],
			notes: [],
			facts: [],
			tables: [
				{
					title: 'Block storage volumes',
					columns: [
						{ key: 'name', label: 'Volume', mono: false },
						{ key: 'size', label: 'Size', mono: true },
					],
					rows: [{ id: 'vol-1', name: 'example-data', cells: { name: 'example-data', size: '100 GiB' }, tone: null }],
					empty: 'No volumes on this account.',
					opens: true,
				},
			],
			links: [],
			actions: [{ label: 'Create volume', form: 'create', tone: 'primary' }],
		},
	};
	const create = {
		type: 'form',
		picker: null,
		form: {
			key: 'create',
			title: 'Create a volume',
			submit: 'Create volume',
			fields: [field('name', 'Name', 'text', 'example-new'), field('size', 'Size (GiB)', 'number', 50)],
			cost: '$5.00 a month for 50 GiB, billed by the hour.',
			notes: [],
			confirmName: null,
			danger: false,
			blocked: null,
		},
	};
	const job = {
		id: 'product-job-sample',
		screen: 'volumes',
		form: 'create',
		target: 'Creating volume example-new',
		startedAt: at,
		finishedAt: at,
		state: 'done',
		message: 'Done.',
		productId: 'vol-2',
		steps: [{ label: 'Sent to DigitalOcean with the PIN', detail: 'Creating volume example-new', state: 'done' }],
	};
	let sent: Record<string, unknown> | null = null;
	await page.route('**/products/volumes/**', (route) => {
		const headers = {
			'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'content-type, x-console-session',
			'access-control-allow-methods': 'GET, POST, OPTIONS',
		};
		const url = route.request().url();
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		const json = (status: number, body: unknown) =>
			route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
		if (route.request().method() === 'POST') {
			sent = route.request().postDataJSON() as Record<string, unknown>;
			return json(202, job);
		}
		if (url.includes('/jobs')) return json(200, sent ? [job] : []);
		if (url.includes('/tab/create')) return json(200, { state: 'ok', readAt: at, data: create });
		return json(200, { state: 'ok', readAt: at, data: list });
	});
	await unlock(page);
	await page.goto(`/p/${base}/r/saha-textile/volumes`);
	await expect(page.getByRole('cell', { name: 'example-data' })).toBeVisible();
	await page.getByRole('button', { name: /Create volume/ }).click();
	await expect(page.getByText('$5.00 a month for 50 GiB, billed by the hour.')).toBeVisible();
	await page.getByLabel('Size (GiB)').fill('60');
	await page.getByRole('button', { name: /Create volume/ }).click();
	const box = page.getByRole('dialog', { name: 'Create a volume' });
	await expect(box).toBeVisible();
	const go = box.getByRole('button', { name: 'Create volume' });
	await expect(go).toBeDisabled();
	await box.getByLabel('PIN digit 1 of 6').click();
	await page.keyboard.type(PIN);
	await go.click();
	await expect(page.getByRole('heading', { name: 'Creating volume example-new' })).toBeVisible();
	expect(sent).toMatchObject({ pin: PIN, values: { name: 'example-new', size: 60 } });
});
