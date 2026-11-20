import { repositorySchema } from '@saha-textile/release-console-contracts';
import { describe, expect, it, vi } from 'vitest';

import { LocalController } from './local.controller.js';

const repo = repositorySchema.parse({
	id: 'saha-textile',
	name: 'saha-textile',
	sourceCode: { vendor: 'github', repository: 'Kaizer-Systems/saha-textile' },
	environments: [
		{ name: 'local', label: 'Local', domains: ['localhost'] },
		{ name: 'staging', label: 'Staging', cloudId: 'digitalocean', domains: ['staging.example.com'] },
		{ name: 'bare', label: 'Bare', cloudId: 'digitalocean', domains: [] },
	],
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean' }],
});

function controller() {
	const runner = { call: vi.fn(async () => ({ id: 'j1', kind: 'seo', label: 'Check the sitemap' })) };
	const store = { audit: vi.fn() };
	const projects = { repository: vi.fn(() => ({ project: {}, repo })) };
	const c = new LocalController(
		runner as never,
		{} as never,
		{} as never,
		store as never,
		{} as never,
		{} as never,
		projects as never,
	);
	return { c, runner, store };
}

const body = (environment: string) => ({ projectId: 'saha-textile', repositoryId: 'saha-textile', environment });

describe('Search engines: the sitemap check', () => {
	it('checks this computer’s stack for an environment that runs here', async () => {
		const { c, runner, store } = controller();
		await c.sitemapCheck(body('local'));
		expect(runner.call).toHaveBeenCalledWith('POST', '/run/sitemap-check', { local: true });
		expect(store.audit).toHaveBeenCalledWith('saha-textile', 'sitemap-check-started', 'saha-textile · Local');
	});

	it('checks a server environment on its first domain, over https', async () => {
		const { c, runner } = controller();
		await c.sitemapCheck(body('staging'));
		expect(runner.call).toHaveBeenCalledWith('POST', '/run/sitemap-check', {
			origin: 'https://staging.example.com',
		});
	});

	it('refuses an environment without a domain or one the repository lacks', async () => {
		const { c, runner } = controller();
		await expect(c.sitemapCheck(body('bare'))).rejects.toThrow(/no domain/);
		await expect(c.sitemapCheck(body('nowhere'))).rejects.toThrow(/no environment/);
		expect(runner.call).not.toHaveBeenCalled();
	});
});
