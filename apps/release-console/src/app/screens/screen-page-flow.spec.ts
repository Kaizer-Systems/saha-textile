import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { ScreenPage } from './screen-page';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';

import type { ConsoleMenu, PlanLock, ScreenInfo } from '../menu/menu.types';

/** The page's members these tests use (protected on the component). */
interface Page {
	titleVendor: () => string | undefined;
	crumb: () => string;
	tabs: () => Array<{ key: string; off: string | null; part: string | null; plan: PlanLock | null }>;
	tabKey: () => string;
	live: () => boolean;
	productScreens: { data: () => unknown };
	product: () => boolean;
	productVendor: () => string;
	envOnServer: () => boolean;
	deployOnServer: () => boolean;
	laterVendor: () => string | null;
	tabIcon(key: string): string | null;
	openTab(key: string): void;
}

const lock = (feature: string): PlanLock => ({ feature, needs: 'Pro', tier: 'pro' });
const screen = (states: Record<string, string>, more: Partial<ScreenInfo> = {}): ScreenInfo => ({
	label: 'Screen',
	states,
	off: false,
	tip: null,
	part: null,
	offStates: null,
	partStates: null,
	captions: {},
	...more,
});
const MENU: ConsoleMenu = {
	menu: [
		{ label: 'Ship', subs: [{ label: null, items: ['pulls', 'deploy'] }] },
		{ label: 'Cloud', vendor: 'digitalocean', subs: [{ label: 'Servers', items: ['droplets', 'later-do-x'] }] },
	],
	aliases: {},
	later: [],
	screens: {
		overview: screen({ main: 'Overview' }),
		pulls: screen({ list: 'List', creating: 'Creating' }),
		deploy: screen({ local: 'Local', staging: 'Staging' }),
		droplets: screen(
			{ list: 'List', region: 'Region', hidden: '' },
			{
				offStates: { region: 'Not yet' },
				partStates: { list: 'Part of it' },
				planStates: { list: lock('f1') },
				plan: lock('f2'),
			},
		),
		'later-do-x': screen({ a: 'A' }, { offStates: { a: 'Later' } }),
	},
};
const REPO = {
	name: 'shop',
	sourceCode: { vendor: 'github' },
	environments: [
		{ name: 'local', cloudId: null },
		{ name: 'staging', cloudId: 'c1' },
	],
};

function make(
	inputs: Record<string, unknown>,
	options: { menu?: ConsoleMenu | null; repo?: unknown; env?: string } = {},
) {
	const api = {
		productTab: vi.fn(async () => ({
			state: 'ok',
			data: {
				type: 'view',
				view: {
					facts: [
						['f1', 'on', 'ok'],
						['f2', 'off', null],
					],
				},
			},
		})),
		productScreens: vi.fn(async () => ({
			droplets: { tabs: ['list'], forms: [], vendor: 'digitalocean' },
			pulls: { tabs: [], forms: ['create'], vendor: 'cloudflare' },
		})),
	};
	const router = { navigate: vi.fn(async () => true) };
	const menu = 'menu' in options ? options.menu : MENU;
	const repo = 'repo' in options ? options.repo : REPO;
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => 'proj_1',
					repoId: () => 'shop',
					repoMenu: () => menu,
					project: () => ({ name: 'Saha Textile' }),
					repo: () => repo,
				},
			},
		],
	});
	TestBed.overrideComponent(ScreenPage, { set: { imports: [], template: '' } });
	TestBed.inject(ConsoleState).setEnvironment(options.env ?? 'local');
	const fixture = TestBed.createComponent(ScreenPage);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Page, api, router };
}

describe('a repository screen', () => {
	it('names where the screen sits, and the provider of a screen still to come', () => {
		expect(make({ screen: 'droplets' }).c.crumb()).toBe('Saha Textile › shop › Cloud › Servers ›');
		expect(make({ screen: 'pulls' }).c.crumb()).toBe('Saha Textile › shop › Ship ›');
		expect(make({}).c.crumb()).toBe('Saha Textile › shop ›');
		expect(make({ screen: 'droplets' }, { menu: null }).c.crumb()).toBe('Saha Textile › shop ›');
		expect(make({ screen: 'later-do-x' }).c.titleVendor()).toBe('digitalocean');
		expect(make({ screen: 'later-none' }).c.titleVendor()).toBeUndefined();
		expect(make({ screen: 'pulls' }).c.titleVendor()).toBeUndefined();
	});

	it('lists the tabs with their states and plan locks, and opens the first one that is on', async () => {
		const { c, router } = make({ screen: 'droplets', tab: 'region' });
		expect(c.tabs().map((t) => t.key)).toEqual(['list', 'region']);
		// Until the plan is read, every lock shows.
		expect(c.tabs()[0]?.plan).toEqual(lock('f1'));
		await vi.waitFor(() => expect(c.tabs()[0]?.plan).toBeNull());
		expect(c.tabs()[0]).toMatchObject({ off: null, part: 'Part of it' });
		expect(c.tabs()[1]).toMatchObject({ off: 'Not yet', part: null, plan: lock('f2') });
		expect(c.tabKey()).toBe('list');
		c.openTab('list');
		expect(router.navigate).toHaveBeenCalledWith([], {
			queryParams: { tab: 'list' },
			queryParamsHandling: 'merge',
		});
		const pulls = make({ screen: 'pulls' });
		expect(pulls.c.tabs()[0]?.plan).toBeNull();
		expect(make({ screen: 'later-do-x' }).c.tabKey()).toBe('');
		expect(make({ screen: 'nowhere' }).c.tabs()).toEqual([]);
	});

	it('says which tabs have live data', () => {
		expect(make({}).c.live()).toBe(true);
		expect(make({ screen: 'droplets' }).c.live()).toBe(true);
		expect(make({ screen: 'pulls' }).c.live()).toBe(true);
		expect(make({ screen: 'pulls', tab: 'creating' }).c.live()).toBe(false);
		expect(make({ screen: 'later-do-x' }).c.live()).toBe(false);
		expect(make({ screen: 'deploy', tab: 'staging' }).c.live()).toBe(true);
		expect(make({ screen: 'deploy' }, { repo: null }).c.live()).toBe(false);
	});

	it('draws a tab from the live product reads, with its vendor', async () => {
		const droplets = make({ screen: 'droplets' });
		await vi.waitFor(() => expect(droplets.c.productScreens.data()).toBeTruthy());
		expect(droplets.c.product()).toBe(true);
		expect(droplets.c.productVendor()).toBe('digitalocean');
		const creating = make({ screen: 'pulls', tab: 'creating' });
		await vi.waitFor(() => expect(creating.c.productScreens.data()).toBeTruthy());
		expect(creating.c.product()).toBe(true);
		expect(creating.c.productVendor()).toBe('cloudflare');
		const list = make({ screen: 'pulls' });
		await vi.waitFor(() => expect(list.c.productScreens.data()).toBeTruthy());
		expect(list.c.product()).toBe(false);
		const deploy = make({ screen: 'deploy' });
		await vi.waitFor(() => expect(deploy.c.productScreens.data()).toBeTruthy());
		expect(deploy.c.product()).toBe(false);
		expect(deploy.c.productVendor()).toBe('digitalocean');
	});

	it('knows when the environment runs on a server, and marks Live deploy tabs with their icon', () => {
		expect(make({}, { env: 'staging' }).c.envOnServer()).toBe(true);
		expect(make({}).c.envOnServer()).toBe(false);
		expect(make({}, { repo: null }).c.envOnServer()).toBe(false);
		const deploy = make({ screen: 'deploy', tab: 'staging' });
		expect(deploy.c.deployOnServer()).toBe(true);
		expect(deploy.c.tabIcon('staging')).toEqual(expect.any(String));
		expect(deploy.c.tabIcon('nowhere')).toBeNull();
		expect(make({ screen: 'deploy' }).c.deployOnServer()).toBe(false);
		expect(make({ screen: 'pulls' }).c.tabIcon('staging')).toBeNull();
	});

	it('notes a source-code vendor that has no Ship screens yet', () => {
		const gitlab = { ...REPO, sourceCode: { vendor: 'gitlab' } };
		expect(make({ screen: 'pulls' }, { repo: gitlab }).c.laterVendor()).toBe('GitLab');
		expect(make({ screen: 'droplets' }, { repo: gitlab }).c.laterVendor()).toBeNull();
		expect(make({ screen: 'pulls' }).c.laterVendor()).toBeNull();
		expect(make({ screen: 'pulls' }, { repo: null }).c.laterVendor()).toBeNull();
	});
});
