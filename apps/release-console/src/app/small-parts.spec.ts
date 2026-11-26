import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { consoleApiBase, ConsoleApi } from './data/console-api';
import { ConsoleContext } from './data/console-context';
import { ConsoleSession } from './data/session';
import { searchList, searchMenu } from './menu/menu-search';
import { DbMonitorScreen } from './screens/db-monitor';
import { levelColour, sparkPoints } from './screens/local-parts';
import { PlannedScreen } from './screens/planned-screen';
import { ServerStateScreen } from './screens/server-state';
import { TroubleSteps, troubleFor } from './screens/trouble';
import { BrandLogo, serviceLogo, warmIcons } from './shared/icons';
import { VendorLogo } from './shared/vendor-logo';

import type { ConsoleMenu } from './menu/menu.types';

/** Builds a part with the console API and context stand-ins it reads, and its inputs set. */
function make<T>(type: Type<T>, inputs: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: {} },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{
				provide: ConsoleContext,
				useValue: { projectId: () => null, repoId: () => null, repo: () => null, environments: () => [] },
			},
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => unknown>;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('where the console API answers', () => {
	it('is the page’s port plus ten while developing, else the page’s own address', () => {
		expect(consoleApiBase(true, { port: '4400', origin: 'http://localhost:4400' })).toBe('http://127.0.0.1:4410');
		expect(consoleApiBase(true, { port: '', origin: '' })).toBe('http://127.0.0.1:4410');
		expect(consoleApiBase(true, undefined)).toBe('http://127.0.0.1:4410');
		expect(consoleApiBase(false, { port: '', origin: 'https://console.local' })).toBe('https://console.local');
		expect(consoleApiBase(false, undefined)).toBe('');
	});
});

describe('icons and logos', () => {
	it('warms every icon quietly, even when Iconify cannot be reached', async () => {
		const fetch = vi.fn(async () => Promise.reject(new Error('offline')));
		vi.stubGlobal('fetch', fetch);
		warmIcons();
		await Promise.resolve();
		expect(fetch).toHaveBeenCalled();
	});

	it('names the product behind a service, and draws one-colour logos light unless told a colour', () => {
		expect(serviceLogo('saha-textile-stack-redis')).toBe('logos/redis');
		expect(serviceLogo('saha-textile-stack-edge')).toBe('logos/nginx');
		expect(serviceLogo('nginx')).toBe('logos/nginx');
		const light = make(BrandLogo, { name: 'simple-icons/github' });
		expect(String(light['src']?.())).toContain('d9f4ff');
		const own = make(BrandLogo, { name: 'logos/redis' });
		expect(String(own['src']?.())).not.toContain('d9f4ff');
		const told = make(BrandLogo, { name: 'simple-icons/github', color: '#ff0000' });
		expect(String(told['src']?.())).toContain('ff0000');
	});

	it('draws a vendor with no logo icon from its site icon', () => {
		const logo = make(VendorLogo, { vendor: 'infisical' });
		expect(String(logo['src']?.())).toContain('infisical.com');
	});
});

describe('trouble steps and charts', () => {
	it('reads certificate and Infisical trouble, and shows no steps for none', () => {
		expect(troubleFor('mkcert: no certificate for localhost')).toBe('certificate');
		expect(troubleFor('Infisical login expired')).toBe('infisical');
		expect(make(TroubleSteps)['steps']?.()).toEqual([]);
		expect((make(TroubleSteps, { trouble: 'disk' })['steps']?.() as unknown[]).length).toBeGreaterThan(0);
	});

	it('colours loads, and draws a sparkline against a given top or a flat line of zeros', () => {
		expect(levelColour(95)).toBe('#ff5d5d');
		expect(levelColour(75)).toBe('#ffb547');
		expect(levelColour(10)).toBe('#5ed6ff');
		expect(sparkPoints([1, 2], 100, 50, 10)).toBe('0.0,42.6 100.0,38.2');
		expect(sparkPoints([0, 0], 100, 50)).toBe('0.0,47.0 100.0,47.0');
	});
});

describe('the session when the browser blocks storage', () => {
	it('starts locked', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		TestBed.resetTestingModule();
		expect(TestBed.inject(ConsoleSession).token()).toBeNull();
	});
});

describe('figures on the database and server screens', () => {
	it('words sizes in MB or GB, uptimes in hours or days, and adds up operations', () => {
		const db = make(DbMonitorScreen);
		expect(db['size']?.(5 * 1024 ** 2)).toBe('5 MB');
		expect(db['size']?.(2 * 1024 ** 3)).toBe('2.0 GB');
		expect(db['days']?.(7200)).toBe('2 h');
		expect(db['days']?.(3 * 86_400)).toBe('3 d');
		expect(db['ops']?.({ insert: 1200, query: 300 })).toBe('1,500');
		const server = make(ServerStateScreen);
		expect(server['pct']?.(null)).toBe('—');
		expect(server['pct']?.(12.4)).toBe('12%');
		expect(server['mb']?.(null)).toBe('—');
		expect(server['mb']?.(3 * 1024 ** 3)).toBe('3.0 GB');
		expect(server['mb']?.(512 * 1024 ** 2)).toBe('512 MB');
	});
});

describe('menu search', () => {
	const menu = {
		menu: [{ label: 'Run', subs: [{ label: null, items: ['deploy'] }] }],
		screens: {
			deploy: { label: 'Live deploy', states: { a: 'Staging', b: '' } },
			hidden: { label: 'Unplaced screen', states: {} },
			pipes: { label: 'The deploy pipes', states: {} },
		},
		aliases: {},
		later: [],
	} as unknown as ConsoleMenu;

	it('ranks start, word start and anywhere matches, skips empty tab names, and paths an unplaced screen as nothing', () => {
		expect(searchMenu(menu, '   ')).toEqual([]);
		const hits = searchMenu(menu, 'deploy');
		expect(hits.map((h) => h.label)).toEqual(['Live deploy', 'The deploy pipes']);
		expect(searchMenu(menu, 'placed')[0]).toMatchObject({ label: 'Unplaced screen', path: '' });
		expect(searchMenu(menu, 'staging')[0]).toMatchObject({ kind: 'tab', state: 'a' });
		const tie = searchMenu(
			{
				...menu,
				screens: { x: { label: 'Beta run', states: {} }, y: { label: 'Alpha run', states: {} } },
			} as never,
			'run',
		);
		expect(tie.map((h) => h.label)).toEqual(['Alpha run', 'Beta run']);
	});

	it('ranks a level’s own list the same way', () => {
		const items = [
			{ label: 'Project settings', path: 'p', link: ['/p'] },
			{ label: 'All projects', path: 'p', link: ['/p'] },
			{ label: 'Subprojects', path: 'p', link: ['/p'] },
		];
		expect(searchList(items, 'project').map((h) => h.score)).toEqual([4, 3, 2]);
	});
});

describe('a screen that comes later', () => {
	it('captions the open tab, else the first caption, else nothing, and names its part', () => {
		const none = make(PlannedScreen);
		expect(none['caption']?.()).toBe('');
		expect(none['part']?.()).toBe('');
		const info = {
			label: 'X',
			states: {},
			captions: { a: 'First', b: 'Second' },
			part: 'Part',
			partStates: { b: 'Part B' },
		};
		const first = make(PlannedScreen, { info, tab: 'zzz' });
		expect(first['caption']?.()).toBe('First');
		expect(first['part']?.()).toBe('Part');
		const second = make(PlannedScreen, { info, tab: 'b' });
		expect(second['caption']?.()).toBe('Second');
		expect(second['part']?.()).toBe('Part B');
		const empty = make(PlannedScreen, { info: { ...info, captions: {}, part: undefined, partStates: undefined } });
		expect(empty['caption']?.()).toBe('');
		expect(empty['part']?.()).toBe('');
	});
});
