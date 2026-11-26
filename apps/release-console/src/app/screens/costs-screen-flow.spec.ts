import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { CostsScreen } from './costs-screen';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	bills: { data: () => unknown };
	servers: { data: () => unknown };
	byEnv: () => Array<{ env: string; names: string[]; monthly: number | null }>;
	others: () => string[];
	readAt: () => string;
	money(value: string | null): string;
}

const REPO = {
	sourceCode: { vendor: 'github' },
	edge: [{ vendor: 'cloudflare' }],
	secrets: [{ vendor: 'infisical' }, { vendor: 'github' }],
	cloud: [
		{ id: 'c1', vendor: 'digitalocean' },
		{ id: 'c2', vendor: 'digitalocean' },
		{ id: 'cf', vendor: 'cloudflare' },
	],
	environments: [{ name: 'staging', label: 'Staging' }],
};
const droplet = (id: number, name: string, size: string) => ({ id, name, size });

function make(repo: unknown) {
	const api = {
		cloudAccount: vi.fn(async (_p: string, _r: string, slot: string) =>
			slot === 'c1'
				? { state: 'ok', data: { monthToDateUsage: '1.50', accountBalance: '0.00' } }
				: { state: 'error', message: 'No key for this account' },
		),
		droplets: vi.fn(async (_p: string, _r: string, slot: string) =>
			slot === 'c1'
				? {
						state: 'ok',
						data: [
							// The untagged one second, so the sort meets it on both sides before putting it last.
							droplet(1, 'web-1', 's-1'),
							droplet(4, 'spare', 's-1'),
							droplet(2, 'web-2', 's-odd'),
							droplet(5, 'web-3', 's-1'),
							droplet(3, 'db', 's-1'),
							droplet(6, 'dev', 's-1'),
						],
					}
				: { state: 'error', message: 'down' },
		),
		doCatalog: vi.fn(async (_p: string, _r: string, slot: string) =>
			slot === 'c1'
				? { state: 'ok', data: { sizes: [{ slug: 's-1', priceMonthly: 6 }] } }
				: { state: 'error', message: 'down' },
		),
		envTags: vi.fn(async () => ({
			'do:droplet:1': 'staging',
			'do:droplet:2': 'staging',
			'do:droplet:5': 'staging',
			'do:droplet:3': 'production',
			'do:droplet:6': 'dev',
		})),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{
				provide: ConsoleContext,
				useValue: { projectId: () => 'proj_1', repoId: () => 'shop', repo: () => repo },
			},
		],
	});
	TestBed.overrideComponent(CostsScreen, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(CostsScreen);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Screen, api };
}

describe('the costs screen', () => {
	it('reads each DigitalOcean bill and groups the servers by their environment, untagged last', async () => {
		const { c } = make(REPO);
		expect(c.readAt()).toBe('reading…');
		await vi.waitFor(() => expect(c.bills.data()).toBeTruthy());
		expect(c.bills.data()).toEqual([
			{ slot: 'c1', ok: true, usage: '1.50', balance: '0.00', message: '' },
			{ slot: 'c2', ok: false, usage: null, balance: null, message: 'No key for this account' },
		]);
		expect(c.readAt()).toMatch(/^read /);
		await vi.waitFor(() => expect(c.servers.data()).toBeTruthy());
		await vi.waitFor(() => expect(c.byEnv().length).toBe(4));
		expect(c.byEnv()).toEqual([
			{ env: 'dev', names: ['dev'], monthly: 6 },
			{ env: 'production', names: ['db'], monthly: 6 },
			{ env: 'Staging', names: ['web-1', 'web-2', 'web-3'], monthly: null },
			{ env: 'no environment', names: ['spare'], monthly: 6 },
		]);
		expect(c.others()).toEqual(['github', 'cloudflare', 'infisical']);
	});

	it('shows nothing without a repository, and writes money with a dollar sign', () => {
		const { c, api } = make(null);
		expect(c.others()).toEqual([]);
		expect(c.byEnv()).toEqual([]);
		expect(api.droplets).not.toHaveBeenCalled();
		expect([c.money(null), c.money(''), c.money('4.20')]).toEqual(['—', '—', '$4.20']);
	});
});
