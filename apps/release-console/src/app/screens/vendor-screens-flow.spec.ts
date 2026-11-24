import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { CfDomainsScreen, DnsScreen, DoAccountScreen, DropletsScreen, PipelinesScreen } from './vendor-screens';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

/** The screens' members these tests use (protected on the components). */
interface Screen {
	q: { data: () => unknown };
	rows: () => unknown[];
	readAt: () => string | null;
	running?: () => number;
	envOfBranch?(branch: string): string;
	stateOf?(status: string, conclusion: string | null): [string, string];
	envOfRecord?(type: string, name: string): string;
}

const READ_AT = '2026-11-24T04:00:00.000Z';
const answer = (data: unknown) => ({ state: 'ok', data, readAt: READ_AT });
const REPO = {
	sourceCode: { vendor: 'github', repository: 'own/shop' },
	cloud: [{ id: 'c1', vendor: 'digitalocean' }],
	edge: [{ id: 'e1', vendor: 'cloudflare', zones: ['example.test'] }],
	environments: [
		{ name: 'staging', label: 'Staging', branch: 'dev', domains: ['staging.example.test'], cloudId: 'c1' },
		{ name: 'production', label: 'Production', branch: '', domains: ['example.test'], cloudId: 'c1' },
	],
};

function make<T>(component: Type<T>, repo: unknown = REPO) {
	const api = {
		runs: vi.fn(async () => answer([{ id: 1 }])),
		droplets: vi.fn(async () =>
			answer([
				{ id: 1, status: 'active' },
				{ id: 2, status: 'off' },
			]),
		),
		cloudAccount: vi.fn(async () => answer({ monthToDateUsage: '1.00' })),
		zones: vi.fn(async () => answer([{ id: 'z1' }])),
		dns: vi.fn(async () => answer([{ id: 'r1' }])),
		envTags: vi.fn(async () => ({})),
		repositoryBranches: vi.fn(async () => ({ defaultBranch: 'main', branches: [] })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{
				provide: ConsoleContext,
				useValue: { projectId: () => 'proj_1', repoId: () => 'shop', repo: () => repo },
			},
		],
	});
	TestBed.overrideComponent(component, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Screen, api };
}

describe('the screens read live from a vendor', () => {
	it('list what each vendor answered, with when it was read', async () => {
		for (const component of [PipelinesScreen, DropletsScreen, CfDomainsScreen, DnsScreen] as Type<unknown>[]) {
			const { c } = make(component);
			expect(c.rows()).toEqual([]);
			expect(c.readAt()).toBeNull();
			await vi.waitFor(() => expect(c.q.data()).toBeTruthy());
			expect(c.rows().length).toBeGreaterThan(0);
			expect(c.readAt()).toBe(READ_AT);
		}
		expect(make(DoAccountScreen).c).toBeTruthy();
	});

	it('counts the droplets that are running', async () => {
		const { c } = make(DropletsScreen);
		await vi.waitFor(() => expect(c.running?.()).toBe(1));
	});

	it('names the environments a branch deploys to, and a dash for none', async () => {
		const pipelines = make(PipelinesScreen);
		await vi.waitFor(() => expect(pipelines.api.repositoryBranches).toHaveBeenCalled());
		await vi.waitFor(() => expect(pipelines.c.envOfBranch?.('main')).toBe('Production'));
		expect(pipelines.c.envOfBranch?.('dev')).toBe('Staging');
		expect(pipelines.c.envOfBranch?.('feature/x')).toBe('—');
		const runs = make(PipelinesScreen, null);
		expect(runs.c.envOfBranch?.('main')).toBe('—');
		const fresh = make(PipelinesScreen);
		expect(fresh.c.envOfBranch?.('dev')).toBe('Staging');
	});

	it('says how each pipeline run went', () => {
		const { c } = make(PipelinesScreen);
		const states = [
			c.stateOf?.('waiting', null),
			c.stateOf?.('in_progress', null),
			c.stateOf?.('completed', 'success'),
			c.stateOf?.('completed', 'failure'),
			c.stateOf?.('completed', 'cancelled'),
			c.stateOf?.('completed', null),
		];
		expect(states).toEqual([
			['amber', 'waiting for approval'],
			['cy', 'in progress'],
			['ok', 'passed'],
			['red', 'failed'],
			['muted', 'cancelled'],
			['muted', 'done'],
		]);
	});

	it('names the environment of a web record from its host, and none for mail or text records', () => {
		const { c } = make(DnsScreen);
		expect(c.envOfRecord?.('MX', 'example.test')).toBe('—');
		expect(c.envOfRecord?.('A', 'staging.example.test')).toBe('Staging');
		expect(c.envOfRecord?.('CNAME', 'other.test')).toBe('—');
		expect(make(DnsScreen, null).c.envOfRecord?.('A', 'example.test')).toBe('—');
	});
});
