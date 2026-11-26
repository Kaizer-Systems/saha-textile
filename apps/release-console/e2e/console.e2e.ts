import { readFileSync } from 'node:fs';

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
	// Locked on a page inside the console, unlocking opens that page again.
	await page.goto('/console/audit');
	await expect(page).toHaveURL(/\/console\/audit$/);
	await page.getByRole('button', { name: /Lock/ }).first().click();
	await expect(page.getByText(/Enter your 6-digit console PIN/)).toBeVisible();
	await page.keyboard.type('000000');
	await expect(page.getByText(/Wrong PIN/i)).toBeVisible();
	await page.keyboard.type(PIN);
	await expect(page).toHaveURL(/\/console\/audit$/);
	// A locked tab that asks for a page goes back to that page after the PIN too.
	await page.getByRole('button', { name: /Lock/ }).first().click();
	await expect(page.getByText(/Enter your 6-digit console PIN/)).toBeVisible();
	await page.goto('/console/projects');
	await expect(page.getByText(/Enter your 6-digit console PIN/)).toBeVisible();
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
	await page.getByRole('checkbox', { name: /Payments/ }).click();
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
	// The content area's loader (brief N5kmX6DLJv1ECitVUPFHJ8): the droplets' own drawing, who and what.
	const loader = page.locator('rc-load-overlay.on:not(.full)');
	await expect(loader.getByText('Reading DigitalOcean')).toBeVisible();
	await expect(loader.locator('.rc-load-what')).toContainText('Droplets');
	await expect(loader.locator('rc-load-piece svg .led').first()).toBeAttached();
	await expect(page.getByText('New droplet for staging')).toBeVisible();
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
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

	// Owner, 23 Nov: when a create finishes, a pop-up asks which environment the server is for, with the
	// repository's own environments; saving keeps the tag in the console (the real API, with the PIN).
	const name = `${base}-staging`;
	const tag = page.getByRole('dialog', { name: `Which environment is ${name} for?` });
	await expect(tag).toBeVisible();
	await expect(tag.getByLabel('Environment', { exact: true })).toHaveValue('staging');
	await expect(tag.getByRole('option')).toHaveText(['No environment', 'Local', 'Staging', 'Production']);
	await tag.getByLabel('PIN digit 1 of 6').click();
	await page.keyboard.type(PIN);
	await tag.getByRole('button', { name: 'Save' }).click();
	await expect(tag).toBeHidden();
	await expect(page.locator('.rc-kv > div', { hasText: 'Environment tag' })).toContainText('staging');

	// Later, from DigitalOcean › Droplets: the list shows the tag, and the same box changes or clears it.
	await page.route('**/cloud/*/droplets', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: cors(route.request().headers()['origin'] ?? '*'),
			body: JSON.stringify({
				state: 'ok',
				readAt: at,
				data: [
					{
						id: 42,
						name,
						status: 'active',
						region: 'blr1',
						size: 's-2vcpu-4gb',
						vcpus: 2,
						memoryMb: 4096,
						diskGb: 80,
						ipv4: '203.0.113.9',
						tags: [base],
						createdAt: at,
					},
				],
			}),
		}),
	);
	await page.goto(`/p/${base}/r/saha-textile/droplets?tab=list`);
	const env = page.getByRole('button', { name: `Tag the environment of ${name}` });
	await expect(env).toHaveText(/staging/);
	await env.click();
	await tag.getByLabel('Environment', { exact: true }).selectOption('');
	await tag.getByLabel('PIN digit 1 of 6').click();
	await page.keyboard.type(PIN);
	await tag.getByRole('button', { name: 'Save' }).click();
	await expect(tag).toBeHidden();
	await expect(env).toHaveText(/Tag environment/);
});

test('pages without the environment switch label each row with its environment', async ({ page }, info) => {
	const base = `browser-test-${info.project.name}`;
	const at = new Date().toISOString();
	await sampleGithub(page);
	await page.route(/\/github\/pulls\?state=/, (route) => {
		const headers = {
			'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
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
				state: 'ok',
				readAt: at,
				data: [
					{
						number: 7,
						title: 'Sale banner',
						author: 'a',
						branch: 'feat/sale',
						base: 'staging',
						draft: false,
						state: 'open',
						updatedAt: at,
						url: 'https://github.com/example/pull/7',
						commits: 1,
						additions: 1,
						deletions: 0,
						checks: null,
						review: 'none',
					},
					{
						number: 8,
						title: 'Release',
						author: 'a',
						branch: 'staging',
						base: 'main',
						draft: false,
						state: 'open',
						updatedAt: at,
						url: 'https://github.com/example/pull/8',
						commits: 1,
						additions: 1,
						deletions: 0,
						checks: null,
						review: 'none',
					},
				],
			}),
		});
	});
	await unlock(page);
	// The switch is gone on Ship › Code; a pull request's target branch names its environments.
	await page.goto(`/p/${base}/r/saha-textile/pulls?tab=list`);
	await expect(page.getByRole('row', { name: /Sale banner/ })).toContainText('Staging');
	await expect(page.getByRole('row', { name: /Release/ })).toContainText('Production');
	await expect(page.locator('.rc-envs')).toHaveCount(0);
	// Run pages are about one environment and keep the switch.
	await page.goto(`/p/${base}/r/saha-textile/services`);
	await expect(page.locator('.rc-envs')).toBeVisible();
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
					rows: [
						{
							id: 'vol-1',
							name: 'example-data',
							cells: { name: 'example-data', size: '100 GiB' },
							tone: null,
						},
					],
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

/** A made-up answer for one console API address (no real account is read). */
async function answerWith(page: Page, url: string, body: unknown): Promise<void> {
	await page.route(url, (route) => {
		const origin = route.request().headers()['origin'] ?? '*';
		const headers = {
			'access-control-allow-origin': origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'content-type, x-console-session',
			'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
		};
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
	});
}

const rotationWaiting = {
	environment: 'staging',
	tier: 'staging',
	state: {
		pending: ['redis'],
		pendingAt: new Date().toISOString(),
		requestedAt: null,
		graceAt: null,
		graceNames: [],
		lastAt: new Date().toISOString(),
		lastChanged: ['REDIS_PASSWORD'],
	},
	graceDaysLeft: null,
};

test('Release Path: a refused deploy, the rotation section and the reachable card on Live deploy', async ({
	page,
}, info) => {
	const at = new Date().toISOString();
	await sampleServerDeploy(page, 'staging');
	await answerWith(page, '**/server-deploy/staging', {
		state: 'ok',
		readAt: at,
		data: {
			environment: 'staging',
			target: 'staging',
			branch: 'staging',
			setup: { environmentExists: true, missingVariables: [], missingSecrets: [], workflowOnBranch: true },
			run: {
				id: 9,
				url: 'https://github.com/example/actions/runs/9',
				branch: 'staging',
				commit: '08ac015',
				status: 'completed',
				conclusion: 'failure',
				createdAt: at,
				waiting: [],
				jobs: [],
			},
			recent: [],
			failure: {
				kind: 'refused-secrets',
				step: null,
				message: 'This release changes secrets the database, Redis or search already run with: redis-password.',
				names: ['redis-password'],
			},
			tags: [],
		},
	});
	await answerWith(page, '**/rotation/staging', rotationWaiting);
	await answerWith(page, '**/droplet-jobs/reachable/staging', {
		environment: 'staging',
		checks: [
			{ key: 'health', label: 'Health through Cloudflare', ok: true, detail: 'answered 200', fix: null },
			{
				key: 'origin-pulls',
				label: 'Origin pulls certificate on api-staging.example.com',
				ok: false,
				detail: 'missing on api-staging.example.com',
				fix: 'origin-pulls',
			},
		],
	});
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/deploy?tab=staging`);
	await expect(page.getByText('Redis password in Infisical differs from what the server runs with.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Deploy again with rotation' })).toBeVisible();
	await expect(page.getByText('Through Cloudflare · not reachable')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Turn origin pulls on again' })).toBeVisible();
	await expect(page.getByText('1 value in Infisical differs from what the server runs.')).toBeVisible();
	await expect(page.getByText('→ release staging --rotate')).toBeVisible();
	const go = page.getByRole('button', { name: 'Deploy and rotate' });
	await expect(go).toBeDisabled();
	await page.getByLabel('Type staging to confirm').fill('staging');
	await page.getByLabel('Console PIN to deploy').getByLabel('PIN digit 1 of 6').click();
	await page.keyboard.type(PIN);
	await expect(go).toBeEnabled();
});

test('Release Path: Rotate, the ready card, the server panels, the database monitor and traces', async ({
	page,
}, info) => {
	const base = `/p/browser-test-${info.project.name}/r/saha-textile`;
	const at = new Date().toISOString();
	await answerWith(page, '**/rotation/staging', rotationWaiting);
	await answerWith(page, '**/droplet-jobs/job-ready', {
		id: 'job-ready',
		kind: 'create',
		environment: 'staging',
		name: 'browser-test-staging',
		state: 'failed',
		startedAt: at,
		finishedAt: at,
		steps: [{ key: 'ready', label: 'What is left for you', detail: 'Not finished', state: 'failed', ms: 1 }],
		dropletId: 42,
		ipv4: '203.0.113.9',
		ipv6: null,
		privateIp: null,
		sshHost: null,
		monthly: 24,
		hourly: 0.036,
		error: 'Not finished: 1 thing left before staging can deploy. Fix it, then Finish setup.',
		left: [{ text: 'GitHub’s staging environment has no required reviewer.', blocking: true }],
	});
	await answerWith(page, '**/server-state/staging', {
		environment: 'staging',
		machine: { state: 'ok', message: 'monitoring', cpuPercent: 14, memoryPercent: 72, diskPercent: 31 },
		shop: { state: 'ok', message: 'queues empty', queues: [] },
		containers: {
			state: 'ok',
			message: '1 running · 0 restarting',
			items: [
				{
					service: 'api',
					name: 'api-1',
					state: 'running',
					health: 'healthy',
					restarts: 0,
					cpuPercent: 3,
					memBytes: 262 * 1024 ** 2,
					memLimitBytes: 768 * 1024 ** 2,
				},
			],
		},
		readAt: at,
	});
	await answerWith(page, '**/server-state/staging/db-report', { error: 'The monitor login is not set up.' });
	await answerWith(page, '**/api/local/tracing', {
		state: 'on',
		store: true,
		address: true,
		apps: ['API', 'Worker', 'Shop'].map((label) => ({
			label,
			service: `saha-textile-${label === 'Shop' ? 'storefront' : label.toLowerCase()}`,
			sending: true,
			note: 'sending · 3 traces in the last hour',
			tone: 'ok',
		})),
	});
	await answerWith(page, '**/api/local/traces?view=slowest', {
		state: 'ok',
		message: '1 traces in the last hour',
		services: ['saha-textile-api'],
		traces: [
			{
				id: 'abcdef0123456789',
				name: 'GET /catalog/products/{{slug}}',
				service: 'saha-textile-api',
				ms: 288,
				status: 200,
				error: false,
				at,
				spans: 2,
				requestId: null,
				build: null,
			},
		],
		edges: [{ from: 'API', to: 'MongoDB', calls: 1, ms: 181 }],
	});
	await answerWith(page, '**/api/local/traces/abcdef0123456789', {
		id: 'abcdef0123456789',
		name: 'GET /catalog/products/{{slug}}',
		service: 'saha-textile-api',
		ms: 288,
		status: 200,
		error: false,
		at,
		requestId: null,
		build: null,
		spans: [
			{
				id: 'a',
				parentId: null,
				name: 'GET /catalog/products/{{slug}}',
				service: 'saha-textile-api',
				where: 'API',
				startMs: 0,
				ms: 288,
				depth: 0,
				error: false,
				query: null,
			},
			{
				id: 'b',
				parentId: 'a',
				name: 'variants.find',
				service: 'saha-textile-api',
				where: 'MongoDB',
				startMs: 30,
				ms: 181,
				depth: 1,
				error: false,
				query: '{ productId: ? }',
			},
		],
		diagnose: [{ rule: 'slow-database', text: 'variants.find on MongoDB took 181 ms', spanId: 'b' }],
	});
	await unlock(page);
	// Run › Secrets › Rotate on Staging: what waits for a deploy with rotation, and the values to pick.
	await page.goto(`${base}/secrets?tab=rotate`);
	await page.locator('.rc-env-tab', { hasText: 'Staging' }).click();
	await expect(page.getByText('Waiting for a deploy with rotation:')).toBeVisible();
	await expect(page.getByText('Database monitor password', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /Make new values/ })).toBeDisabled();
	// The create job's ready card: what is left, and Finish setup.
	await page.goto(`${base}/droplets?tab=creating&job=job-ready`);
	await expect(page.getByText('Left for you', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
	// Run › Infrastructure on Staging: DigitalOcean monitoring, /ops and the observer's containers.
	await page.goto(`${base}/infra`);
	await page.locator('.rc-env-tab', { hasText: 'Staging' }).click();
	await expect(page.getByText('CPU 14% · memory 72% · disk 31%')).toBeVisible();
	await expect(page.getByRole('cell', { name: 'api', exact: true })).toBeVisible();
	await page.goto(`${base}/queries`);
	await page.locator('.rc-env-tab', { hasText: 'Staging' }).click();
	await expect(page.getByText('The monitor login is not set up.')).toBeVisible();
	// Watch › Traces on Local: the slowest request, its waterfall and Diagnose.
	await page.goto(`${base}/traces?tab=list`);
	await page.locator('.rc-env-tab', { hasText: 'Local' }).click();
	await page.locator('.rc-main table').getByRole('button', { name: 'Waterfall' }).click();
	await expect(page.getByText('variants.find on MongoDB took 181 ms')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open in Database monitor' })).toBeVisible();
});

test('Tracing switch: off, Turn tracing on with the PIN and its output, then the Sending list and Turn tracing off', async ({
	page,
}, info) => {
	const base = `/p/browser-test-${info.project.name}/r/saha-textile`;
	const at = new Date().toISOString();
	const apps = (shop: { sending: boolean; note: string; tone: string }) => [
		{
			label: 'API',
			service: 'saha-textile-api',
			sending: true,
			note: 'sending · 12 traces in the last hour',
			tone: 'ok',
		},
		{
			label: 'Worker',
			service: 'saha-textile-worker',
			sending: true,
			note: 'sending · 2 traces in the last hour',
			tone: 'ok',
		},
		{ label: 'Shop', service: 'saha-textile-storefront', ...shop },
	];
	await answerWith(page, '**/api/local/jobs', []);
	await answerWith(page, '**/api/local/tracing', { state: 'off', store: false, address: false, apps: [] });
	const job = {
		id: 'job-trace',
		kind: 'stack',
		label: 'Turn tracing on for this Mac',
		status: 'passed',
		startedAt: at,
		finishedAt: at,
		exitCode: 0,
		lines: [
			{
				seq: 1,
				stream: 'out',
				text: '17:42:03 Trace store started · 127.0.0.1:10428 · keeps 7 days, at most 2 GiB',
				event: null,
			},
			{
				seq: 2,
				stream: 'out',
				text: '17:42:05 Local stack: address set · restarting api, worker, storefront…',
				event: null,
			},
			{ seq: 3, stream: 'out', text: '17:42:41 First traces: API ✓ · worker ✓ · shop —', event: null },
		],
	};
	await answerWith(page, '**/api/local/run/tracing-on', job);
	await answerWith(page, '**/api/local/jobs/job-trace*', job);
	await unlock(page);
	await page.goto(`${base}/traces?tab=list`);
	await page.locator('.rc-env-tab', { hasText: 'Local' }).click();
	await expect(page.getByText('Tracing is off on this Mac.')).toBeVisible();
	await expect(page.getByText('http://127.0.0.1:10428/insert/opentelemetry/v1/traces')).toBeVisible();
	// Pressed again if the first press did not reach the page while this Mac was busy (seen once, 23 Nov).
	const output = page.getByText('Output · Turn tracing on for this Mac');
	await expect(async () => {
		if (!(await output.isVisible())) {
			await page.getByLabel('Console PIN to turn tracing on').fill('123456');
			await page.getByRole('button', { name: 'Turn tracing on' }).click();
		}
		await expect(output).toBeVisible({ timeout: 5000 });
	}).toPass({ timeout: 30_000 });
	await expect(page.getByText('17:42:03', { exact: true })).toBeVisible();
	await expect(page.getByText('First traces: API ✓ · worker ✓ · shop —')).toBeVisible();
	// On, with the shop started in a terminal before the address: the Sending list says why.
	await answerWith(page, '**/api/local/tracing', {
		state: 'on',
		store: true,
		address: true,
		apps: apps({
			sending: false,
			note: 'runs on :4200, started outside the console before tracing was turned on · it sends from its next start',
			tone: 'amber',
		}),
	});
	await answerWith(page, '**/api/local/traces?view=slowest', {
		state: 'ok',
		message: '1 traces in the last hour',
		services: ['saha-textile-api'],
		traces: [],
		edges: [],
	});
	await page.reload();
	await page.locator('.rc-env-tab', { hasText: 'Local' }).click();
	await expect(page.getByText('Sending · the last hour')).toBeVisible();
	await expect(page.getByText(/started outside the console before tracing was turned on/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Turn tracing off' })).toBeVisible();
	// The store stopped by itself: the amber banner and Start it again.
	await answerWith(page, '**/api/local/tracing', { state: 'stopped', store: false, address: true, apps: [] });
	await page.reload();
	await page.locator('.rc-env-tab', { hasText: 'Local' }).click();
	await expect(page.getByText('The trace store has stopped,')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start it again' })).toBeVisible();
});

/**
 * Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23). The answers are real: this Mac's coverage of the
 * console API and contracts folders, run through the console's own coverage model when the fixtures were
 * made (two runs listed, one still going), with one failure added so the failure card can be checked.
 */
async function sampleCoverage(page: Page): Promise<void> {
	const fixture = (name: string) => readFileSync(new URL(`fixtures/coverage-${name}.json`, import.meta.url), 'utf8');
	await page.route('**/coverage/runs', (route) =>
		route.fulfill({ contentType: 'application/json', body: fixture('runs') }),
	);
	await page.route('**/coverage/tree?**', (route) =>
		route.fulfill({ contentType: 'application/json', body: fixture('tree') }),
	);
	await page.route('**/coverage/file?**', (route) => {
		const path = new URL(route.request().url()).searchParams.get('path') ?? '';
		const body = path.endsWith('github-deploys.ts')
			? fixture('file-deploys')
			: path.endsWith('zip.ts')
				? fixture('file-zip')
				: JSON.stringify({
						state: 'ok',
						readAt: '2026-11-24T03:00:00.000Z',
						data: {
							path,
							sha: 'f00d',
							counts: null,
							text: ['// a test file'],
							lines: [{ h: null, c: 'none', notes: [] }],
							gaps: [],
							specs: [],
							failures: [],
							changed: [],
							note: 'Not measured: this file has no code the tests run (styles, templates, data, docs or settings).',
						},
					});
		return route.fulfill({ contentType: 'application/json', body });
	});
}

test('Coverage shows the tree with every folder’s numbers, a file at the side, its gaps, a failure and the map', async ({
	page,
}, info) => {
	await sampleCoverage(page);
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/coverage?tab=tree`);
	await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible();
	// The newest run with reports opens; a run still going cannot be chosen.
	const run = page.getByLabel('CI run');
	await expect(run).toHaveValue('901');
	await expect(run.locator('option[value="902"]')).toBeDisabled();
	await expect(page.getByText('whole codebase', { exact: true })).toBeVisible();
	await expect(page.locator('.rc-stat').filter({ hasText: 'tests' })).toContainText('1 failed');
	// Both dropdowns are the console's own, and Compare with sits in its row, clear of the table below it.
	const compare = page.getByRole('combobox', { name: 'Compare with' });
	await expect(run).toHaveClass(/rc-select/);
	await expect(compare).toHaveClass(/rc-select/);
	// One arrow: the console's ▾, with Chrome's own picker icon hidden.
	expect(await compare.evaluate((el) => getComputedStyle(el, '::picker-icon').display)).toBe('none');
	await compare.scrollIntoViewIfNeeded();
	const [box, table] = await Promise.all([compare.boundingBox(), page.locator('table.rc-t').first().boundingBox()]);
	// The console's 12 px between parts, so the row never sits on the table's border.
	expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((table?.y ?? 0) - 8);
	// The console's loader shows for a second on every page; the picture waits for it to lift.
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	const screen = page.viewportSize() ?? { width: 1280, height: 720 };
	const top = Math.max(0, (box?.y ?? 0) - 120);
	await page.screenshot({
		path: info.outputPath('coverage-compare-with.png'),
		clip: { x: 0, y: top, width: screen.width, height: Math.min(screen.height, (table?.y ?? 0) + 80) - top },
	});
	// A folder opens one level; a workspace whose tests failed says so.
	await page.locator('tr.row[data-path="apps"]').click();
	await expect(page.locator('tr.row[data-path="apps/release-console-api"]')).toContainText('1 test failed');
	// Find a file, open it at the side.
	await page.keyboard.press('/');
	await page.getByLabel('Find a file').fill('github-deploys');
	await page.locator('tr.row[data-path="apps/release-console-api/src/vendors/github-deploys.ts"]').click();
	await expect(page.locator('.rc-cov-code .l').first()).toBeVisible();
	await expect(page.locator('.rc-cov-code .l.err').first()).toBeVisible();
	await expect(page.locator('.rc-cov-code .rc-pill.amber').first()).toContainText(/never/);
	await expect(page).toHaveURL(/file=apps%2Frelease-console-api%2Fsrc%2Fvendors%2Fgithub-deploys\.ts/);
	// n steps to the first gap and puts its line in the address.
	await page.locator('.rc-cov-code').click();
	await page.keyboard.press('n');
	await expect(page).toHaveURL(/line=\d+/);
	await expect(page.locator('.rc-cov-code .l.flash')).toHaveCount(1);
	// The gap list, then the failure with expected against received.
	await page.getByRole('tab', { name: /^Gaps/ }).click();
	await expect(page.locator('.rc-kv [role="button"]').first()).toContainText(
		/never (true|false|called|ran|reached|needed)/,
	);
	await page.getByRole('tab', { name: /^Tests/ }).click();
	await expect(page.getByText("expected 'waiting' to be 'approved'")).toBeVisible();
	// Run on This Mac takes the PIN; this browser test has no Mac helper, so it says so.
	await page.getByLabel('Console PIN to run a test file on this Mac').fill(PIN);
	await page.getByRole('button', { name: /Run github-deploys\.test\.ts on This Mac/ }).click();
	await expect(page.getByText(/Mac helper/).first()).toBeVisible();
	await expect(page.getByText("'approved'", { exact: true })).toBeVisible();
	await expect(page.getByText("'waiting'", { exact: true })).toBeVisible();
	// A step of the failure opens that line in the same pane.
	await page.getByRole('button', { name: 'apps/release-console-api/src/vendors/github-deploys.ts:40' }).click();
	await expect(page.locator('.rc-cov-code .l[data-ln="40"]')).toHaveClass(/flash/);
	await page.getByRole('tab', { name: /^Tests/ }).click();
	await page.getByRole('button', { name: /github-deploys\.test\.ts:12/ }).click();
	await expect(page.getByText(/^Not measured/)).toBeVisible();
	// Esc closes the file and takes it out of the address.
	await page.keyboard.press('Escape');
	await expect(page.locator('.rc-cov-code')).toHaveCount(0);
	await expect(page).not.toHaveURL(/file=/);
	// The run's slowest test files.
	await page.getByRole('button', { name: 'Slowest tests', exact: true }).click();
	await expect(page.getByText('Slowest test files · this run')).toBeVisible();
	await expect(
		page
			.locator('.rc-kv')
			.filter({ hasText: /\.test\.ts/ })
			.first(),
	).toContainText(/\d+\.\d s/);
	// The map: boxes sized by code; a folder box goes inside.
	await page.getByRole('button', { name: 'Map', exact: true }).click();
	const apps = page.locator('.rc-cov-box[title^="apps ·"]');
	await expect(apps).toBeVisible();
	await apps.click();
	await expect(page.locator('.rc-cov-box[title^="apps/release-console-api ·"]')).toBeVisible();
});

test('Pull requests: a row opens its page with the whole description, the conversation, commits, checks and changed lines', async ({
	page,
}, info) => {
	const at = new Date().toISOString();
	const title =
		'feat: everything since PR #6 — shop, admin, orders, accounts, media, Page Builder, Release Console, deployment, and the long tail of fixes';
	const section = (n: number) =>
		`<h2>Section ${n}</h2><p>${'Everything built since PR #6, from 7 to 23 November 2026: <strong>1,139 commits</strong> across the shop, the admin and the API. '.repeat(6)}</p><h3>Part ${n}.1</h3><ul><li>One</li><li>Two with <code>code</code></li></ul>`;
	const body =
		Array.from({ length: 22 }, (_, i) => section(i + 1)).join('') +
		'<p>See <a href="https://github.com/o/r/pull/6">#6</a>.</p>';
	const check = (id: number, name: string, status: string, actionsJob = true) => ({
		id,
		name,
		app: actionsJob ? 'GitHub Actions' : 'SonarCloud',
		status,
		startedAt: at,
		completedAt: status === 'running' ? null : at,
		url: 'https://github.com/o/r/runs/1',
		actionsJob,
	});
	const pr = {
		number: 7,
		title,
		state: 'open',
		draft: false,
		author: 'kaizer03',
		base: 'dev',
		head: 'feat/combined-after-pr6',
		baseSha: 'base0001',
		headSha: '33d575f3aaaabbbb',
		url: 'https://github.com/o/r/pull/7',
		createdAt: at,
		updatedAt: at,
		mergedAt: null,
		mergedBy: '',
		closedAt: null,
		bodyHtml: body,
		bodyLength: 37071,
		commits: 1339,
		additions: 623963,
		deletions: 41288,
		changedFiles: 4105,
		mergeable: true,
		mergeableState: 'blocked',
		autoMerge: false,
		canAutoMerge: true,
		checks: { total: 3, running: 1, passed: 1, failed: 1 },
		checkList: [
			check(1, 'Lint & Typecheck', 'passed'),
			check(2, 'Browser tests on production builds', 'failed'),
			check(3, 'Sonar', 'running', false),
		],
		review: 'required',
		reviewers: [],
		labels: [],
		events: [
			{
				kind: 'opened',
				who: 'kaizer03',
				at,
				text: 'opened this pull request',
				html: '',
				tone: null,
				sha: '',
				checkId: null,
				url: '',
			},
			{
				kind: 'pushed',
				who: 'kaizer03',
				at,
				text: 'pushed 14 commits d932b3e5 … 33d575f3',
				html: '',
				tone: null,
				sha: '',
				checkId: null,
				url: '',
			},
			{
				kind: 'commented',
				who: 'kaizer03',
				at,
				text: 'commented',
				html: '<p>Please check the media <code>.zip</code> test first.</p>',
				tone: null,
				sha: '',
				checkId: null,
				url: '',
			},
			{
				kind: 'check-failed',
				who: '',
				at,
				text: 'Browser tests on production builds failed on 33d575f3',
				html: '',
				tone: 'red',
				sha: '',
				checkId: 2,
				url: '',
			},
		],
	};
	const row = {
		number: 7,
		title,
		author: 'kaizer03',
		branch: pr.head,
		base: 'dev',
		draft: false,
		state: 'open',
		updatedAt: at,
		url: pr.url,
		commits: 1339,
		additions: 623963,
		deletions: 41288,
		checks: { total: 12, running: 10, passed: 2, failed: 0 },
		review: 'required',
	};
	const files = [
		'apps/release-console/src/app/screens/vendor-screens.ts',
		'apps/release-console/src/styles.css',
		'docs/release-console/pulls.md',
	].map((path) => ({
		path,
		previous: null,
		status: 'modified',
		additions: 6,
		deletions: 1,
		binary: false,
	}));
	const diff = {
		path: files[0]?.path,
		previous: null,
		status: 'modified',
		binary: false,
		sizeBefore: null,
		sizeAfter: null,
		whole: false,
		source: 'copy',
		lines: [
			{ kind: 'hunk', old: null, new: null, text: '@@ -112,7 +112,12 @@ export class VendorState {' },
			{ kind: 'ctx', old: 112, new: 112, text: '\t\t@for (p of rows(); track p.number) {' },
			{ kind: 'del', old: 113, new: null, text: '\t\t\t<tr>' },
			{ kind: 'add', old: null, new: 113, text: '\t\t\t<tr' },
			{ kind: 'add', old: null, new: 114, text: '\t\t\t\ttabindex="0"' },
			{ kind: 'add', old: null, new: 115, text: '\t\t\t\t(click)="open(p.number)"' },
		],
	};
	const answers: Array<[string | RegExp, unknown]> = [
		[/\/github\/pulls\?state=/, { state: 'ok', readAt: at, data: [row] }],
		[/\/github\/pulls\/7$/, { state: 'ok', readAt: at, data: pr }],
		[
			/\/github\/pulls\/7\/commits\?/,
			{
				state: 'ok',
				readAt: at,
				data: {
					total: 1339,
					page: 1,
					pages: 14,
					commits: [
						{
							sha: '33d575f3aaaabbbb',
							headline: 'test(e2e): the media .zip test waits for the .zip’s own answer',
							author: 'kaizer03',
							date: at,
							checks: 'running',
						},
					],
				},
			},
		],
		[
			/\/github\/pulls\/7\/files$/,
			{
				state: 'ok',
				readAt: at,
				data: {
					total: 4105,
					source: 'copy',
					note: '4,105 files. GitHub lists a pull request’s first 3,000, so this list and every change come from the console’s own copy of the repository.',
					files,
				},
			},
		],
		[/\/github\/pulls\/7\/diff\?/, { state: 'ok', readAt: at, data: diff }],
		[
			/\/checks\/2\/log$/,
			{
				state: 'ok',
				readAt: at,
				data: {
					lines: [
						{ n: 1331, text: '1) [admin] › e2e/media-page.admin.spec.ts:122:6', bad: false },
						{ n: 1334, text: 'Error: expect(locator).toBeVisible() failed', bad: true },
					],
				},
			},
		],
	];
	await page.route(/\/api\/projects\/.*\/github\/pulls/, (route) => {
		const origin = route.request().headers()['origin'] ?? '*';
		const headers = {
			'access-control-allow-origin': origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'content-type, x-console-session',
			'access-control-allow-methods': 'GET, POST, OPTIONS',
		};
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		const url = route.request().url();
		const body = answers.find(([re]) => (re instanceof RegExp ? re.test(url) : url.includes(re)))?.[1] ?? {
			state: 'error',
			message: 'not stubbed',
		};
		return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
	});
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/pulls`);
	await expect(page.getByText('10 running')).toBeVisible();
	// The dropdown is drawn in the console's look, list included.
	const which = page.getByRole('combobox', { name: 'Which pull requests' });
	expect(await which.evaluate((el) => getComputedStyle(el).appearance)).toBe('base-select');
	// The console's loader shows for a second on every page; the picture waits for it to lift.
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('pull-requests-list.png'), fullPage: true });
	// The whole row opens the pull request's page, as GitHub's list does.
	await page.getByRole('cell', { name: new RegExp(title.slice(0, 30)) }).click();
	await expect(page).toHaveURL(/pr=7/);
	await expect(page).toHaveURL(/tab=overview/);
	const heading = page.locator('h3.rc-pr-title');
	await expect(heading).toContainText('the long tail of fixes');
	// Two boxes overlap when neither lies wholly beside or below the other.
	const apart = async (a: import('@playwright/test').Locator, b: import('@playwright/test').Locator) => {
		const [x, y] = [await a.boundingBox(), await b.boundingBox()];
		if (!x || !y) throw new Error('not drawn');
		return (
			x.x + x.width <= y.x + 0.5 ||
			y.x + y.width <= x.x + 0.5 ||
			x.y + x.height <= y.y + 0.5 ||
			y.y + y.height <= x.y + 0.5
		);
	};
	const badge = heading.locator('.rc-pill');
	await expect(badge).toHaveText('merge blocked');
	// On a phone the buttons fold under Actions ▾.
	const phone = info.project.name === 'phone';
	if (phone) await page.getByRole('button', { name: 'Actions ▾' }).click();
	for (const name of ['Merge', 'Review', 'Close, reopen or update'])
		expect(await apart(badge, page.getByRole('button', { name, exact: true }))).toBe(true);
	await expect(page.locator('.rc-mergebox')).toContainText('1 of 3 checks running');
	await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled();
	// The branch boxes keep the console's 12 px clear of the merge status box (owner, 24 Nov: they sat on its border),
	// the base has its ▾ and the head its copy button (brief 7Hu1SuB3A8qiJzeDwvFZLR, A1–A4).
	const branchBox = await page.locator('.rc-pr-meta .rc-pr-pair').last().boundingBox();
	const mergeBox = await page.locator('.rc-mergebox').boundingBox();
	if (!branchBox || !mergeBox) throw new Error('not drawn');
	expect(mergeBox.y - (branchBox.y + branchBox.height)).toBeGreaterThanOrEqual(11.5);
	await expect(page.getByRole('button', { name: 'Change the base branch' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copy the branch name' })).toBeVisible();
	await page.locator('.rc-pr-head').screenshot({ path: info.outputPath('pull-request-header.png') });
	// The whole description, with its outline; the last section is there too.
	await expect(page.getByText('Description · 37,071 characters · as GitHub draws it')).toBeVisible();
	await expect(page.locator('.rc-md h2', { hasText: 'Section 22' })).toHaveCount(1);
	const outline = page.getByRole('navigation', { name: 'Outline of the description' });
	// On a phone the outline is a menu over the page, opened by Outline ▾; picking a heading closes it.
	if (phone) await page.getByRole('button', { name: 'Outline ▾' }).click();
	await expect(outline.getByRole('button')).toHaveCount(44);
	if (phone) await page.getByRole('button', { name: 'Outline ▾' }).click();
	const description = page.locator('.rc-md').first();
	const box = await description.boundingBox();
	const panel = await page.locator('.rc-pr-main .rc-panel').first().boundingBox();
	expect(box && panel && box.x + box.width <= panel.x + panel.width + 0.5).toBe(true);
	// The console's loader shows for a second on every page; the picture waits for it to lift.
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('pull-request-overview.png'), fullPage: true });
	if (phone) await page.getByRole('button', { name: 'Outline ▾' }).click();
	await outline.getByRole('button', { name: 'Section 20' }).click();
	if (phone) await expect(outline).toBeHidden();
	await expect(page.locator('.rc-pr-outline button', { hasText: 'Section 20' })).toHaveClass(/on/);
	// A failed check in the conversation opens its log on the Checks tab.
	await page.getByRole('button', { name: 'open its log' }).click();
	await expect(page).toHaveURL(/tab=checks/);
	await expect(page.locator('.rc-log .l.err')).toContainText('toBeVisible() failed');
	// The console's loader shows for a second on every page; the picture waits for it to lift.
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('pull-request-checks.png'), fullPage: true });
	// Keys: 2 opens Commits; 4 opens Files changed, read from the console's own copy past GitHub's 3,000.
	await page.keyboard.press('2');
	await expect(page.getByText('1,339 commits, all from GitHub')).toBeVisible();
	await page.keyboard.press('4');
	await expect(page.getByText('4,105 files. GitHub lists a pull request’s first 3,000')).toBeVisible();
	await expect(page.locator('.rc-cov-code .l.add')).toHaveCount(3);
	await expect(page.locator('.rc-cov-code .l.del')).toHaveCount(1);
	// The console's loader shows for a second on every page; the picture waits for it to lift.
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('pull-request-files.png'), fullPage: true });
	await page.keyboard.press('Escape');
	await expect(page).not.toHaveURL(/pr=7/);
});

test('Code: the repository’s home, a folder, a file with marked lines, Go to file, branches and search', async ({
	page,
}, info) => {
	const at = new Date().toISOString();
	const head = {
		sha: '10217986aaaabbbbcccc',
		headline: 'fix(gst): the API starts again, and the GSTR-2B and GSTR-3B pages',
		author: 'Moulik Patra',
		login: 'kaizer03',
		date: at,
		checks: 'passed',
	};
	const last = { sha: head.sha, headline: head.headline, date: at };
	const coverage = Array.from({ length: 40 }, (_, i) =>
		i === 34 ? 'const COVERAGE_FLOOR = 10;' : `// line ${i + 1} of scripts/coverage.mjs`,
	).join('\n');
	const ok = (data: unknown) => ({ state: 'ok', readAt: at, data });
	const branch = (name: string, over: Record<string, unknown> = {}) => ({
		name,
		isDefault: false,
		rule: false,
		sha: head.sha,
		date: at,
		author: 'Moulik Patra',
		login: 'kaizer03',
		behind: 0,
		ahead: 0,
		pull: null,
		checks: 'none',
		...over,
	});
	const answer = (url: URL): unknown => {
		const action = url.pathname.split('/github/code/')[1];
		const path = url.searchParams.get('path') ?? '';
		const ref = url.searchParams.get('ref') ?? 'main';
		if (action === 'repo')
			return ok({
				owner: 'Kaizer-Systems',
				name: 'saha-textile',
				url: 'https://github.com/Kaizer-Systems/saha-textile',
				visibility: 'public',
				description: null,
				homepage: null,
				topics: [],
				stars: 0,
				watchers: 0,
				forks: 0,
				defaultBranch: 'main',
				viewer: 'kaizer03',
				license: null,
				watching: 'none',
				starred: false,
				branches: 4,
				tags: 0,
				releases: { total: 0, latest: null },
				environments: [
					{ name: 'staging', deployedAt: null, state: null },
					{ name: 'production', deployedAt: null, state: null },
				],
				contributors: { total: 1, people: [{ login: 'kaizer03', contributions: 1700 }] },
				languages: [
					{ name: 'TypeScript', color: '#3178c6', share: 69.5 },
					{ name: 'JavaScript', color: '#f1e05a', share: 29.4 },
					{ name: 'CSS', color: '#563d7c', share: 1.1 },
				],
				community: [{ key: 'readme', label: 'README', path: 'README.md' }],
			});
		if (action === 'tree')
			return ok({
				ref,
				sha: head.sha,
				path,
				head,
				commits: path ? 120 : 1700,
				entries: path
					? [{ name: 'coverage.mjs', path: 'scripts/coverage.mjs', kind: 'file', last }]
					: [
							{ name: 'apps', path: 'apps', kind: 'dir', last },
							{ name: 'docs', path: 'docs', kind: 'dir', last },
							{ name: 'scripts', path: 'scripts', kind: 'dir', last },
							{ name: 'README.md', path: 'README.md', kind: 'file', last },
						],
				readme: path
					? null
					: {
							path: 'README.md',
							html: '<h1>Saha Textile</h1><p>Custom rebuild of sahatextile.com off WooCommerce, as a pnpm + Turborepo monorepo.</p>',
						},
			});
		if (action === 'refs')
			return ok({
				defaultBranch: 'main',
				branches: [
					{ name: 'main', rule: true },
					{ name: 'dev', rule: true },
					{ name: 'staging', rule: true },
					{ name: 'feat/combined-after-pr6', rule: false },
				],
				tags: [],
			});
		if (action === 'paths')
			return ok({
				ref,
				sha: head.sha,
				paths: ['README.md', 'scripts/coverage.mjs', 'apps/release-console/src/app/screens/coverage-file.ts'],
			});
		if (action === 'file')
			return ok({
				ref,
				sha: head.sha,
				path,
				size: coverage.length,
				kind: 'text',
				text: coverage,
				lines: 40,
				html: null,
				last: head,
			});
		if (action === 'branches')
			return ok({
				defaultBranch: 'main',
				viewer: 'kaizer03',
				rows: [
					branch('main', { isDefault: true, rule: true }),
					branch('feat/combined-after-pr6', { ahead: 1699, pull: { number: 7, state: 'open' } }),
					branch('dev', { rule: true, ahead: 316 }),
				],
			});
		if (action === 'search')
			return ok({
				total: 1,
				cut: false,
				files: [{ path: 'scripts/coverage.mjs', lines: [{ n: 35, text: 'const COVERAGE_FLOOR = 10;' }] }],
			});
		if (action === 'packages') return ok({ packages: [] });
		return { state: 'error', message: 'not stubbed' };
	};
	await page.route(/\/api\/projects\/.*\/github\/code\//, (route) => {
		const origin = route.request().headers()['origin'] ?? '*';
		const headers = {
			'access-control-allow-origin': origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-headers': 'content-type, x-console-session',
			'access-control-allow-methods': 'GET, POST, OPTIONS',
		};
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		const body = answer(new URL(route.request().url()));
		return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
	});
	const noSideScroll = async () =>
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
	await unlock(page);
	// A branch name on a pull request opens this page on that branch (brief 7Hu1SuB3A8qiJzeDwvFZLR, Q2 C).
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/code?tab=files&ref=feat%2Fcombined-after-pr6`);
	await expect(page.getByText('Kaizer-Systems / saha-textile')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Switch branches or tags: feat/combined-after-pr6' })).toBeVisible();
	const files = page.getByRole('table', { name: 'Files' });
	await expect(files.getByRole('row')).toHaveCount(4);
	await expect(page.locator('.rc-md h1', { hasText: 'Saha Textile' })).toBeVisible();
	await expect(page.getByText('TypeScript 69.5%')).toBeVisible();
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await noSideScroll();
	await page.screenshot({ path: info.outputPath('code-home.png'), fullPage: true });
	// The switcher lists the branches, the one shown ticked.
	await page.getByRole('button', { name: 'Switch branches or tags: feat/combined-after-pr6' }).click();
	const switcher = page.getByRole('dialog', { name: 'Switch branches or tags' });
	await expect(switcher.getByText('main')).toBeVisible();
	await page.screenshot({ path: info.outputPath('code-switcher.png') });
	await switcher.getByRole('button', { name: 'Close' }).click();
	// A folder, then a file in it; a line number marks the line in the address.
	// The name opens the entry; the middle column is its last commit's link, as on GitHub.
	await files
		.getByRole('row', { name: /scripts/ })
		.getByRole('cell')
		.first()
		.click();
	await expect(page).toHaveURL(/path=scripts(&|$)/);
	// Up a level is GitHub's folder named "..", saying where it leads; every row lights up under the pointer.
	const up = page.getByRole('table', { name: 'Files' }).getByRole('row', { name: /^\.\.$/ });
	await expect(up).toHaveAttribute('title', 'Up to saha-textile');
	await expect(up.locator('rc-icon')).toHaveCount(1);
	const wash = (row: typeof up) =>
		row
			.locator('td')
			.first()
			.evaluate((td) => getComputedStyle(td).backgroundColor);
	const resting = await wash(up);
	await up.hover();
	await expect.poll(() => wash(up)).not.toBe(resting);
	expect(await up.evaluate((tr) => getComputedStyle(tr).cursor)).toBe('pointer');
	await page
		.getByRole('table', { name: 'Files' })
		.getByRole('row', { name: /coverage\.mjs/ })
		.getByRole('cell')
		.first()
		.click();
	await expect(page).toHaveURL(/path=scripts%2Fcoverage\.mjs/);
	await expect(page.getByText(/40 lines/)).toBeVisible();
	await page.locator('.rc-cov-code .n').nth(34).click();
	await expect(page).toHaveURL(/#L35$/);
	await expect(page.locator('.rc-cov-code .l.part')).toHaveCount(1);
	// The file tree and the code hand the scroll over to the page at their end (owner, 26 Nov).
	for (const box of [page.locator('.rc-cov-tree').first(), page.locator('.rc-cov-code').first()])
		expect(await box.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('auto');
	// The file tree tells folders from files by their icons, as the file list does.
	const treeIcons = page.locator('.rc-cov-tree tr.row rc-icon');
	// On a phone the tree folds away behind Files ▾; its rows still carry the icons.
	await expect(treeIcons.first()).toBeAttached();
	const drawn = await treeIcons.evaluateAll(
		(icons) => new Set(icons.map((icon) => (icon as HTMLElement).style.getPropertyValue('--rc-icon'))).size,
	);
	expect(drawn).toBe(2);
	// A hover name sits above the page, whole, under its button and inside the window (owner, 26 Nov).
	const copyPath = page.getByRole('button', { name: 'Copy the path' });
	await copyPath.hover();
	const tip = page.locator('.rc-tipbox');
	await expect(tip).toHaveText('Copy the path');
	const [named, under] = await Promise.all([tip.boundingBox(), copyPath.boundingBox()]);
	expect(named?.x ?? -1).toBeGreaterThanOrEqual(0);
	expect((named?.x ?? 0) + (named?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
	expect(named?.y ?? 0).toBeGreaterThanOrEqual((under?.y ?? 0) + (under?.height ?? 0));
	await page.mouse.move(0, 0);
	await expect(tip).toBeHidden();
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await noSideScroll();
	await page.screenshot({ path: info.outputPath('code-file.png'), fullPage: true });
	// t opens Go to file; letters in order find a file anywhere in the branch.
	await page.keyboard.press('t');
	const finder = page.getByRole('dialog', { name: 'Go to file' });
	await finder.getByRole('searchbox', { name: 'Go to file' }).fill('covfile');
	await expect(finder.getByRole('option')).toHaveCount(1);
	await page.screenshot({ path: info.outputPath('code-finder.png') });
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/coverage-file\.ts/);
	// Branches: the default, its rules and the pull request of a branch.
	await page.getByRole('tab', { name: /Branches/ }).click();
	await expect(page).toHaveURL(/tab=branches/);
	// The overview lists a branch under both Your branches and Active branches, as GitHub's does.
	await expect(page.getByRole('button', { name: '#7 open' })).toHaveCount(2);
	await expect(page.locator('rc-load-overlay.on')).toHaveCount(0);
	await noSideScroll();
	await page.screenshot({ path: info.outputPath('code-branches.png'), fullPage: true });
	// Search finds the line, which opens the file there.
	await page.getByRole('searchbox', { name: 'Search this repository' }).fill('COVERAGE_FLOOR');
	await page.getByRole('searchbox', { name: 'Search this repository' }).press('Enter');
	await expect(page).toHaveURL(/tab=search/);
	await expect(page.locator('mark', { hasText: 'COVERAGE_FLOOR' }).first()).toBeVisible();
	await page.screenshot({ path: info.outputPath('code-search.png'), fullPage: true });
});
