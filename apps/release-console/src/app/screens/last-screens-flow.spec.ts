import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AlertsScreen } from './alerts-screen';
import { ApmScreen } from './apm-screen';
import { DbMonitorScreen } from './db-monitor';
import { DepsScreen } from './deps-screen';
import { DomainsScreen } from './domains-screen';
import { EnvTagDialog } from './env-tag-dialog';
import { LocalGate } from './local-parts';
import { OverviewScreen } from './overview-screen';
import { TracesScreen } from './traces-screen';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';

const ENVS = [
	{ name: 'local', label: 'Local', cloudId: null, domains: [] },
	{ name: 'staging', label: 'Staging', cloudId: 'c1', domains: ['staging.example.test'] },
];
const REPO = {
	cloud: [{ id: 'c1', vendor: 'digitalocean' }],
	edge: [{ id: 'e1', vendor: 'cloudflare' }],
	environments: ENVS,
};

/** Any call the test does not name answers nothing, as a quiet console API would. */
function apiWith(calls: Record<string, unknown>): unknown {
	return new Proxy(calls, {
		get: (target, key: string) => (key in target ? target[key] : key === 'then' ? undefined : async () => null),
	});
}

function make<T>(
	component: Type<T>,
	calls: Record<string, unknown>,
	options: { inputs?: Record<string, unknown>; env?: string } = {},
) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: apiWith(calls) },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{ provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => 'proj_1',
					repoId: () => 'shop',
					repo: () => REPO,
					environments: () => ENVS,
				},
			},
		],
	});
	TestBed.overrideComponent(component, { set: { imports: [], template: '' } });
	TestBed.inject(ConsoleState).setEnvironment(options.env ?? 'local');
	const fixture = TestBed.createComponent(component);
	for (const [name, value] of Object.entries(options.inputs ?? {})) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown, fixture };
}
const line = (text: string, stream = 'out') => ({ seq: 1, text, stream, event: null });

describe('the traces screen', () => {
	interface Traces {
		raw: { set(v: boolean): void };
		output: () => unknown[];
		lineTone(l: unknown): string;
		ms(v: number): string;
	}

	it('reads the errors list on its tab, and tones each line of the tracing run', async () => {
		const traces = vi.fn(async () => ({ traces: [] }));
		const c = make(TracesScreen, { traces, jobs: vi.fn(async () => []) }, { inputs: { tab: 'errors' } })
			.c as Traces;
		await vi.waitFor(() => expect(traces).toHaveBeenCalledWith('errors'));
		c.raw.set(true);
		expect(c.output()).toEqual([]);
		expect(
			[line('Failed to start'), line('oops', 'err'), line('Reading…'), line('Started')].map((l) => c.lineTone(l)),
		).toEqual(['err', 'dim', '', 'ok']);
		expect([c.ms(1500), c.ms(12.4)]).toEqual(['1.50 s', '12 ms']);
	});
});

describe('the smaller screens', () => {
	it('reads the database report from the server when the environment runs on one', async () => {
		const dbReport = vi.fn(async () => ({}));
		make(DbMonitorScreen, { dbReport }, { env: 'staging' });
		await vi.waitFor(() => expect(dbReport).toHaveBeenCalledWith('proj_1', 'shop', 'staging'));
	});

	it('names a certificate’s environments, warns before it ends, and writes its end date', () => {
		const c = make(DomainsScreen, {}).c as {
			envOf(hosts: string[]): string;
			soon(iso: string | null): boolean;
			when(iso: string | null): string;
		};
		expect(c.envOf(['nowhere.test'])).toBe('—');
		expect(c.envOf(['staging.example.test'])).toBe('Staging');
		const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString();
		expect(c.soon(inFiveDays)).toBe(true);
		expect(c.soon(null)).toBe(false);
		expect(c.when(inFiveDays)).toMatch(/days$/);
	});

	it('lists each environment with where it runs and its domains', () => {
		const c = make(OverviewScreen, {}).c as { envs: () => Array<Record<string, unknown>> };
		expect(c.envs()[1]).toMatchObject({
			vendor: 'digitalocean',
			runsOnName: 'DigitalOcean',
			domains: 'Domains: staging.example.test.',
		});
		expect(c.envs()[0]).toMatchObject({ vendor: null, runsOnName: 'this computer', domains: '' });
	});

	it('draws a firing disk alert as a share of the disk', async () => {
		const alerts = vi.fn(async () => ({ firing: [{ rule: 'disk' }], rules: [] }));
		const history = vi.fn(async () => [
			{ name: 'disk_used', points: [[1, 50]] },
			{ name: 'disk_total', points: [[1, 200]] },
		]);
		const c = make(AlertsScreen, { alerts, history }, { inputs: { tab: 'firing' } }).c as {
			diskValues: () => number[];
		};
		await vi.waitFor(() => expect(c.diskValues()).toEqual([25]));
	});

	it('clears an environment tag when none is picked, and says when nothing answered', async () => {
		const setEnvTag = vi.fn(async () => undefined);
		const { c, fixture } = make(
			EnvTagDialog,
			{ setEnvTag },
			{ inputs: { resource: 'do:droplet:1', name: 'web-1' } },
		);
		const saved = vi.fn();
		(fixture.componentInstance as EnvTagDialog).saved.subscribe(saved);
		const dialog = c as { save(): Promise<void>; message: () => string };
		await dialog.save();
		expect(setEnvTag).toHaveBeenCalledWith('proj_1', 'shop', { pin: '', key: 'do:droplet:1', env: null });
		expect(saved).toHaveBeenCalledWith(null);
		setEnvTag.mockRejectedValueOnce('down');
		await dialog.save();
		expect(dialog.message()).toBe('The console API did not answer.');
	});

	it('draws a missing p95 as zero, and orders GitHub’s alerts by severity', async () => {
		const requests = vi.fn(async () => ({
			routes: [],
			series: [
				[1, null, 0],
				[2, 120, 0.1],
			],
		}));
		const apm = make(ApmScreen, { requests }).c as { p95Values: () => number[] };
		await vi.waitFor(() => expect(apm.p95Values()).toEqual([0, 120]));
		const security = vi.fn(async () => ({ state: 'ok', data: { alerts: [] }, readAt: '' }));
		const deps = make(DepsScreen, { security }).c as { severities: () => unknown[]; view: { data: () => unknown } };
		await vi.waitFor(() => expect(deps.view.data()).toBeTruthy());
		expect(Array.isArray(deps.severities())).toBe(true);
	});

	it('lets this computer’s screens through for a local environment only', () => {
		expect((make(LocalGate, {}).c as { onThisComputer: () => boolean }).onThisComputer()).toBe(true);
		expect((make(LocalGate, {}, { env: 'staging' }).c as { onThisComputer: () => boolean }).onThisComputer()).toBe(
			false,
		);
	});
});
