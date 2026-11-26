import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { ProjectPage } from './project-page';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { CONSOLE_MENU } from '../menu/console-menu.data';

import type { Repository } from '@saha-textile/release-console-contracts';

/** The page's members these tests use (protected on the component). */
interface Page {
	title: () => string;
	settingsTab: () => string;
	headIcon: () => string;
	removeMessage: () => string;
	attention: { data: () => unknown };
	envRows: () => Array<{ runsOn: string | null; domains: string; secrets: string | null }>;
	attentionIcon(kind: string): string;
	menusOf(r: Repository): string;
	openRepo(repoId: string): void;
	remove(e: Event, typed: string): Promise<void>;
}

const REPO = {
	id: 'shop',
	name: 'shop',
	menus: [],
	cloud: [{ id: 'c1', vendor: 'digitalocean' }],
	secrets: [{ id: 's1', vendor: 'infisical' }],
	environments: [
		{
			name: 'staging',
			label: 'Staging',
			cloudId: 'c1',
			secretsId: 's1',
			domains: ['a.test', 'b.test'],
			secretsPath: '/',
		},
		{ name: 'local', label: 'Local', cloudId: null, secretsId: null, domains: [], secretsPath: '' },
	],
};
const PROJECT = { id: 'proj_1', name: 'Saha Textile', repositories: [REPO] };

function make(inputs: Record<string, unknown>, options: { project?: unknown; api?: Record<string, unknown> } = {}) {
	const api = {
		attention: vi.fn(async () => []),
		audit: vi.fn(async () => []),
		removeProject: vi.fn(async () => undefined),
		...options.api,
	};
	const router = { navigate: vi.fn(async () => true) };
	const project = 'project' in options ? options.project : PROJECT;
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{
				provide: ConsoleContext,
				useValue: { projectId: () => (project ? 'proj_1' : null), project: () => project },
			},
		],
	});
	TestBed.overrideComponent(ProjectPage, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProjectPage);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Page, api, router };
}
const submit = () => ({ preventDefault: vi.fn() }) as unknown as Event;

describe('the project page', () => {
	it('names each page and settings tab, with its icon, and falls back for a page it does not know', () => {
		const settings = make({ page: 'settings', tab: 'menus' });
		expect(settings.c.title()).toBe('Project menus');
		expect(settings.c.headIcon()).toBe('tabler/list-details');
		const unknownTab = make({ page: 'settings', tab: 'nope' });
		expect(unknownTab.c.settingsTab()).toBe('connections');
		expect(make({ page: 'settings' }).c.title()).toBe('Connections');
		expect(make({}).c.title()).toBe('Project overview');
		const audit = make({ page: 'audit' });
		expect(audit.c.title()).toBe('Audit');
		expect(audit.c.headIcon()).toBe('tabler/history');
		const stray = make({ page: 'stray' });
		expect(stray.c.title()).toBe('Project overview');
		expect(stray.c.headIcon()).toBe('tabler/layout-dashboard');
	});

	it('reads what needs attention on its page, and lists each environment with where it runs', async () => {
		const { c, api } = make({ page: 'attention' });
		await vi.waitFor(() => expect(c.attention.data()).toEqual([]));
		expect(api.attention).toHaveBeenCalledWith('proj_1');
		expect(c.envRows()).toEqual([
			expect.objectContaining({ runsOn: 'digitalocean', domains: 'a.test, b.test', secrets: 'infisical' }),
			expect.objectContaining({ runsOn: null, domains: '—', secrets: null }),
		]);
		expect(make({ page: 'attention' }, { project: null }).c.envRows()).toEqual([]);
	});

	it('picks an icon for each kind of Attention row, and names a repository menus', () => {
		const { c, router } = make({});
		expect(['key-old', 'ci-red', 'approval-wait', 'local-alert', 'other'].map((k) => c.attentionIcon(k))).toEqual([
			'tabler/key',
			'tabler/route-2',
			'tabler/circle-check',
			'tabler/alert-triangle',
			'tabler/bell-ringing',
		]);
		const known = Object.keys(CONSOLE_MENU.screens)[0] as string;
		const label = CONSOLE_MENU.screens[known]?.label;
		expect(c.menusOf({ ...REPO, menus: [known, 'own-menu'] } as unknown as Repository)).toBe(`${label}, own-menu`);
		expect(c.menusOf(REPO as unknown as Repository)).toBe('none');
		c.openRepo('shop');
		expect(router.navigate).toHaveBeenCalledWith(['/p', 'proj_1', 'r', 'shop', 'overview']);
	});

	it('removes the project only when its name is typed, and says why it could not', async () => {
		const { c, api, router } = make({ page: 'settings', tab: 'remove' });
		await c.remove(submit(), 'Wrong name');
		expect(c.removeMessage()).toBe('Type the project name exactly: Saha Textile');
		expect(api.removeProject).not.toHaveBeenCalled();
		await c.remove(submit(), ' Saha Textile ');
		expect(api.removeProject).toHaveBeenCalledWith('proj_1');
		expect(router.navigate).toHaveBeenCalledWith(['/console', 'projects']);
		api.removeProject.mockRejectedValueOnce(new Error('Not allowed'));
		await c.remove(submit(), 'Saha Textile');
		expect(c.removeMessage()).toBe('Not allowed');
		const none = make({ page: 'settings', tab: 'remove' }, { project: null });
		await none.c.remove(submit(), 'Saha Textile');
		expect(none.api.removeProject).not.toHaveBeenCalled();
	});
});
