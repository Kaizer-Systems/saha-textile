import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecretsScreen, tierOf } from './secrets-screen';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { SecretDrafts } from '../data/secret-drafts';

import type { Repository } from '@saha-textile/release-console-contracts';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	envLabel: () => string;
	onServer: () => boolean;
	place: () => unknown;
	later: () => unknown;
	unplaced: () => unknown;
	placeLabel: () => string;
	shown: () => Array<{ folder: string; rows: unknown[] }>;
	problems: () => number;
	tierIcon: () => string;
	waiting: () => unknown[];
	groups: () => Array<{ folder: string; names: string[] }>;
	fill: () => Array<{ name: string; place: string }>;
	fillsThis: () => boolean;
	saving: WritableSignal<boolean>;
	busy: WritableSignal<boolean>;
	pin: WritableSignal<string>;
	confirmName: WritableSignal<string>;
	message: () => string;
	copied: () => boolean;
	filling: WritableSignal<boolean>;
	fillError: () => string;
	results: () => unknown[];
	view: { data: () => unknown };
	places: { data: () => unknown };
	stateOfRow(row: object): { cls: string; word: string };
	folderIcon(folder: string): string;
	readAt(iso: string): string;
	fresh(): void;
	draftOf(folder: string, name: string): string;
	isOpen(folder: string, name: string): boolean;
	edit(folder: string, name: string): void;
	undo(folder: string, name: string): void;
	type(folder: string, name: string, value: string): void;
	discardAll(): void;
	openSave(): void;
	closeSave(): void;
	openSettings(): void;
	useFill(): Promise<void>;
	copy(text: string): void;
	ready(): boolean;
	save(e: Event): Promise<void>;
	unsaved(e: Event): void;
}

const env = (name: string, over: object = {}) => ({
	name,
	label: name.toUpperCase(),
	cloudId: null,
	domains: [],
	secretsId: null,
	secretsPath: '',
	branch: '',
	...over,
});
const REPO = {
	id: 'shop',
	name: 'shop',
	role: '',
	sourceCode: { vendor: 'github', repository: 'Own/Shop', keyId: null },
	environments: [
		env('local', { secretsId: 'inf', secretsPath: 'saha-textile-local/dev' }),
		env('staging', { cloudId: 'do', secretsId: 'inf', secretsPath: 'saha-textile-staging/staging/api' }),
		env('production', { cloudId: 'do' }),
		env('qa', { secretsId: 'vault', secretsPath: 'kv/qa' }),
		env('development', { cloudId: 'do', secretsId: 'inf', secretsPath: 'not a place' }),
		env('preview', { cloudId: 'do' }),
	],
	cloud: [],
	edge: [],
	secrets: [
		{ id: 'inf', vendor: 'infisical', address: '', keyIds: [] },
		{ id: 'vault', vendor: 'vault', address: 'https://vault.example.com', keyIds: [] },
	],
	menus: [],
} as unknown as Repository;

const VIEW = {
	tier: 'staging',
	project: 'saha-textile-staging',
	environment: 'staging',
	folder: '/',
	readAt: '2026-11-20T10:00:00Z',
	folders: [
		{
			folder: 'api',
			rows: [
				{ name: 'A', state: 'set', optional: false },
				{ name: 'B', state: 'empty', optional: true },
				{ name: 'C', state: 'missing', optional: false },
			],
		},
		{ folder: 'shop', rows: [{ name: 'D', state: 'set', optional: false }] },
	],
};
const PLACES = {
	repository: 'own/shop',
	places: [
		{ tier: 'production', project: 'saha-textile-production', environment: 'prod' },
		{ tier: 'development', project: 'saha-textile-development', environment: 'dev' },
	],
};

function make(
	environment: string,
	options: { repo?: Repository | null; ids?: boolean; tab?: string; view?: unknown; places?: unknown } = {},
) {
	const repo = signal(options.repo === undefined ? REPO : options.repo);
	const api = {
		secrets: vi.fn(async () => (options.view ?? VIEW) as unknown),
		secretsPlaces: vi.fn(async () => (options.places ?? PLACES) as unknown),
		saveSecrets: vi.fn(async () => ({
			results: [
				{ folder: 'api', saved: true },
				{ folder: 'shop', saved: false },
			],
		})),
		updateRepository: vi.fn(async (_projectId: string, _repo: unknown) => undefined),
	};
	const refetch = vi.fn(async () => undefined);
	const router = { navigate: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => (options.ids === false ? null : 'proj_1'),
					repoId: () => (options.ids === false ? null : 'shop'),
					repo,
					projects: { refetch },
				},
			},
		],
	});
	TestBed.overrideComponent(SecretsScreen, { set: { imports: [], template: '' } });
	TestBed.inject(ConsoleState).setEnvironment(environment);
	const fixture = TestBed.createComponent(SecretsScreen);
	if (options.tab) fixture.componentRef.setInput('tab', options.tab);
	fixture.detectChanges();
	const c = fixture.componentInstance as unknown as Screen;
	return { c, api, router, refetch, repo, fixture, drafts: TestBed.inject(SecretDrafts) };
}
const submit = () => ({ preventDefault: vi.fn() }) as unknown as Event;

afterEach(() => {
	TestBed.inject(SecretDrafts).clear();
	vi.useRealTimers();
});

describe('the name-list tier an environment suggests', () => {
	it('reads production, staging, this computer, development, and nothing else', () => {
		expect(tierOf('Production', false)).toBe('production');
		expect(tierOf('staging-2', false)).toBe('staging');
		expect(tierOf('box', true)).toBe('local');
		expect(tierOf('local-2', false)).toBe('local');
		expect(tierOf('dev', false)).toBe('development');
		expect(tierOf('preview', false)).toBeNull();
	});
});

describe('Run › Secrets: an environment with an Infisical place', () => {
	it('reads the names in the place, per folder, and only those that need the owner on the problem tab', async () => {
		const { c, api } = make('staging');
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		expect(api.secrets).toHaveBeenCalledWith(
			{ projectId: 'proj_1', repositoryId: 'shop', environment: 'staging' },
			false,
		);
		expect(c.envLabel()).toBe('STAGING');
		expect(c.onServer()).toBe(true);
		expect(c.placeLabel()).toBe('saha-textile-staging · staging');
		expect(c.shown()).toHaveLength(2);
		expect(c.problems()).toBe(1);
		expect(c.tierIcon()).toBeTruthy();
		expect(c.stateOfRow({ state: 'set' })).toEqual({ cls: 'ok', word: 'set' });
		expect(c.stateOfRow({ state: 'empty', optional: true }).word).toBe('empty · may stay');
		expect(c.stateOfRow({ state: 'empty', optional: false }).cls).toBe('amber');
		expect(c.stateOfRow({ state: 'missing', optional: true }).word).toBe('not added · may stay');
		expect(c.stateOfRow({ state: 'missing', optional: false }).cls).toBe('red');
		expect(c.stateOfRow({ state: 'unread' }).word).toBe('not read');
		expect(c.folderIcon('deployment')).toBe('tabler/rocket');
		expect(c.folderIcon('elsewhere')).toBe('tabler/folder');
		expect(c.readAt('2026-11-20T10:00:00Z')).toContain('2026');
		c.fresh();
		await vi.waitFor(() => expect(api.secrets).toHaveBeenCalledTimes(2));
	});

	it('keeps only the rows that need the owner on the problem tab, and a folder the view names in the label', async () => {
		const { c } = make('staging', { tab: 'problem' });
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		expect(c.shown()).toEqual([{ folder: 'api', rows: [{ name: 'C', state: 'missing', optional: false }] }]);
		const before = make('local', { view: { ...VIEW, project: undefined, environment: undefined, folder: '/api' } });
		expect(before.c.placeLabel()).toBe('saha-textile-local · dev');
		await vi.waitFor(() => expect(before.c.view.data()).toBeTruthy());
		expect(before.c.placeLabel()).toBe('saha-textile-local · dev · /api');
	});

	it('keeps drafts per tier, groups them by folder, and saves them once the name and PIN are typed', async () => {
		const { c, api, drafts } = make('staging');
		expect(c.draftOf('api', 'C')).toBe('');
		expect(c.isOpen('api', 'C')).toBe(false);
		c.edit('api', 'C');
		c.type('api', 'C', 'x');
		c.undo('api', 'C');
		c.discardAll();
		expect(drafts.count()).toBe(0);
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		c.edit('api', 'C');
		expect(c.isOpen('api', 'C')).toBe(true);
		c.type('api', 'C', 'secret-1');
		c.type('api', 'A', 'secret-2');
		c.type('shop', 'D', 'secret-3');
		expect(c.draftOf('api', 'C')).toBe('secret-1');
		expect(c.groups()).toEqual([
			{ folder: 'api', names: ['A', 'C'] },
			{ folder: 'shop', names: ['D'] },
		]);
		c.undo('shop', 'D');
		c.type('shop', 'D', 'secret-3');
		const leave = submit();
		c.unsaved(leave);
		expect(leave.preventDefault).toHaveBeenCalled();
		c.openSave();
		expect(c.saving()).toBe(true);
		expect(c.ready()).toBe(false);
		await c.save(submit());
		expect(api.saveSecrets).not.toHaveBeenCalled();
		c.confirmName.set(' Staging ');
		c.pin.set('123456');
		expect(c.ready()).toBe(true);
		await c.save(submit());
		expect(api.saveSecrets).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'proj_1', confirmName: ' Staging ', changes: expect.any(Array) }),
		);
		expect(c.results()).toHaveLength(2);
		expect(c.groups()).toEqual([{ folder: 'shop', names: ['D'] }]);
		expect(c.saving()).toBe(false);
		api.saveSecrets.mockRejectedValueOnce(new Error('PIN refused'));
		await c.save(submit());
		expect(c.message()).toBe('PIN refused');
		c.closeSave();
		c.discardAll();
		const stay = submit();
		c.unsaved(stay);
		expect(stay.preventDefault).not.toHaveBeenCalled();
	});

	it('needs no typed name on this computer, and sends empty ids when there are none', async () => {
		const { c, api } = make('local', { ids: false });
		await vi.waitFor(() => expect(c.view.data()).toBeTruthy());
		expect(api.secrets).toHaveBeenCalledWith({ projectId: '', repositoryId: '', environment: 'local' }, false);
		c.type('api', 'C', 'v');
		c.pin.set('123456');
		expect(c.ready()).toBe(true);
		c.busy.set(true);
		expect(c.ready()).toBe(false);
		c.busy.set(false);
		await c.save(submit());
		expect(api.saveSecrets).toHaveBeenCalledWith(expect.objectContaining({ projectId: '', repositoryId: '' }));
		await c.useFill();
		expect(api.updateRepository).not.toHaveBeenCalled();
	});
});

describe('Run › Secrets: environments without a readable place', () => {
	it('says a manager is read later, a place cannot be read, or there is none', () => {
		const later = make('qa');
		expect(later.c.later()).toMatchObject({ vendor: 'vault' });
		expect(later.c.place()).toBeNull();
		expect(later.c.placeLabel()).toBe('');
		const unplaced = make('development');
		expect(unplaced.c.unplaced()).toMatchObject({ text: 'not a place' });
		const none = make('production', { repo: null });
		expect(none.c.place()).toBeNull();
		expect(none.c.envLabel()).toBe('production');
		expect(none.c.fill()).toEqual([]);
		expect(none.c.waiting()).toEqual([]);
	});

	it('offers to fill in the places the name list knows, only for its own repository, and fills them in', async () => {
		const { c, api, refetch } = make('production');
		await vi.waitFor(() => expect(c.fill().length).toBeGreaterThan(0));
		expect(c.fill()).toEqual([
			{ name: 'production', label: 'PRODUCTION', place: 'saha-textile-production · prod' },
			{ name: 'development', label: 'DEVELOPMENT', place: 'saha-textile-development · dev' },
		]);
		expect(c.fillsThis()).toBe(true);
		c.filling.set(true);
		await c.useFill();
		expect(api.updateRepository).not.toHaveBeenCalled();
		c.filling.set(false);
		await c.useFill();
		const sent = api.updateRepository.mock.calls[0]?.[1] as unknown as Repository;
		expect(sent.secrets.map((x) => x.id)).toEqual(['inf', 'vault']);
		expect(sent.environments.find((e) => e.name === 'production')).toMatchObject({
			secretsId: 'inf',
			secretsPath: 'saha-textile-production · prod',
		});
		expect(refetch).toHaveBeenCalled();
		api.updateRepository.mockRejectedValueOnce(new Error('Stale project'));
		await c.useFill();
		expect(c.fillError()).toBe('Stale project');
	});

	it('adds an Infisical slot with a free id when the repository has none', async () => {
		const noInfisical = {
			...REPO,
			environments: [env('production', { cloudId: 'do' })],
			secrets: [{ id: 'infisical', vendor: 'vault', address: 'https://v.example.com', keyIds: [] }],
		} as unknown as Repository;
		const { c, api } = make('production', { repo: noInfisical });
		await vi.waitFor(() => expect(c.fill().length).toBe(1));
		await c.useFill();
		const sent = api.updateRepository.mock.calls[0]?.[1] as unknown as Repository;
		expect(sent.secrets.map((x) => x.id)).toEqual(['infisical', 'infisical-2']);
	});

	it('offers nothing when the name list belongs to another repository or names none', async () => {
		const elsewhere = make('production', { places: { repository: 'own/other', places: [] } });
		await vi.waitFor(() => expect(elsewhere.c.places.data()).toBeTruthy());
		expect(elsewhere.c.fill()).toEqual([]);
		const unnamed = make('production', { places: { repository: null, places: [] } });
		await vi.waitFor(() => expect(unnamed.c.places.data()).toBeTruthy());
		expect(unnamed.c.fill()).toEqual([]);
		expect(elsewhere.c.fillsThis()).toBe(false);
	});

	it('opens the repository settings, and copies a name with the clipboard or the copy command', async () => {
		const { c, router } = make('production');
		c.openSettings();
		expect(router.navigate).toHaveBeenCalledWith(['/p', 'proj_1', 'settings'], {
			queryParams: { tab: 'repositories', repo: 'shop' },
		});
		vi.useFakeTimers();
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		c.copy('production');
		await vi.advanceTimersByTimeAsync(0);
		expect(c.copied()).toBe(true);
		await vi.advanceTimersByTimeAsync(1500);
		expect(c.copied()).toBe(false);
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		const exec = vi.fn(() => true);
		Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
		c.copy('production');
		expect(exec).toHaveBeenCalledWith('copy');
		expect(c.copied()).toBe(true);
		exec.mockReturnValueOnce(false);
		await vi.advanceTimersByTimeAsync(1500);
		c.copy('production');
		expect(c.copied()).toBe(false);
	});
});
