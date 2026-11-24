import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddProject, STEPS, branchProblem, edgeProblem, placeNote, secretsProblem, suggestBranch } from './add-project';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

/** The wizard's own members these tests use (they are protected on the component). */
interface Wizard {
	at: WritableSignal<number>;
	message: WritableSignal<string>;
	notice: WritableSignal<string>;
	pending: WritableSignal<string | null>;
	showSignIn: WritableSignal<boolean>;
	name: WritableSignal<string>;
	workspace: WritableSignal<string>;
	repoVendor: WritableSignal<string>;
	repos: WritableSignal<
		Array<{ repository: string; link: string; file: string; menus: string[]; renamedTo: string }>
	>;
	envs: WritableSignal<
		Array<{ name: string; label: string; branches: Record<string, string>; secretsFrom: unknown }>
	>;
	lists: WritableSignal<Record<string, { note: string }>>;
	extraClouds: WritableSignal<Set<string>>;
	edgeList: WritableSignal<Array<{ vendor: string; zones: string }>>;
	secretsList: WritableSignal<Array<{ vendor: string; address: string }>>;
	workspaces: () => string[];
	nextLabel: () => string;
	problem: () => string;
	shortName(repository: string): string;
	waitingFor(repository: string): string;
	branchesOf(repository: string): unknown[];
	listOf(repository: string): unknown;
	connect(repository: string, mode?: string): void;
	afterClose(connected: boolean): void;
	afterSignIn(): Promise<void>;
	useNewName(old: string, name: string): void;
	loadBranches(repository: string, refresh?: boolean): Promise<void>;
	setBranch(i: number, repository: string, branch: string): void;
	menuLabel(key: string): string;
	menuCaption(key: string): string;
	addRepo(box: HTMLInputElement, role: HTMLInputElement): void;
	dropRepo(repository: string): void;
	setRunsOn(i: number, cloud: string | null): void;
	usedBy(cloud: string): string;
	setDomains(i: number, domains: string): void;
	addEnv(box: HTMLInputElement): void;
	dropEnv(i: number): void;
	toggleCloud(cloud: string): void;
	edgeOn(vendor: string): boolean;
	toggleEdge(vendor: string): void;
	setZones(i: number, zones: string): void;
	secretsOn(vendor: string): boolean;
	toggleSecrets(vendor: string): void;
	setSecretsAddress(i: number, address: string): void;
	setSecretsFrom(i: number, from: string): void;
	managerOf(env: unknown): string | null;
	setSecretsPath(i: number, path: string): void;
	toggleMenu(repository: string, menu: string): void;
	draft(): { repositories: Array<{ environments: Array<{ branch: string; secretsId: unknown }> }> };
	back(): void;
	next(): Promise<void>;
}
type Private = Record<string, (...args: unknown[]) => Promise<void>>;

const BRANCHES = {
	defaultBranch: 'main',
	current: 'dev',
	branches: ['main', 'dev', 'staging'].map((name) => ({ name, onGitHub: true, onThisComputer: true })),
	note: '',
};
const FILE_FOUND = {
	state: 'ok',
	data: { found: true, menus: ['overview', 'not-a-screen'], manifest: { parts: [{}, {}] }, problems: ['bad line'] },
};

const projects = signal<unknown>(undefined);
const box = (value: string) => Object.assign(document.createElement('input'), { value });

function make() {
	const api = {
		githubCheck: vi.fn(async () => ({ signedIn: true, account: 'owner', reachable: true, fullName: 'own/shop' })),
		repositoryBranches: vi.fn(async () => BRANCHES),
		repositoryFile: vi.fn(async () => FILE_FOUND as unknown),
		addProject: vi.fn(async () => ({ id: 'acme' })),
		linkKey: vi.fn(async () => undefined),
		setSlotKeys: vi.fn(async () => undefined),
	};
	const router = { navigate: vi.fn(async () => true) };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{ provide: QueryClient, useValue: queries },
			{ provide: ConsoleContext, useValue: { projects: { data: () => projects() } } },
		],
	});
	TestBed.overrideComponent(AddProject, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(AddProject);
	const c = fixture.componentInstance as unknown as Wizard;
	return { c, own: c as unknown as Private, api, router, queries };
}

const repo = (c: Wizard, repository: string) => c.repos().find((r) => r.repository === repository);

afterEach(() => {
	projects.set(undefined);
});

describe('add project: repositories and the GitHub connection', () => {
	it('adds repositories in owner/name form once each, with the menus note by vendor', () => {
		const { c } = make();
		c.addRepo(box('not a repo'), box(''));
		expect(c.message()).toBe('Write the repository as owner/name.');
		const role = box(' Shop ');
		const name = box('own/shop');
		c.addRepo(name, role);
		expect(name.value).toBe('');
		expect(repo(c, 'own/shop')?.file).toBe('read after Connect');
		c.addRepo(box('own/shop'), box(''));
		expect(c.repos()).toHaveLength(1);
		c.repoVendor.set('gitlab');
		c.addRepo(box('own/docs'), box(''));
		expect(repo(c, 'own/docs')?.file).toBe('tick them on Project menus');
		expect(c.shortName('own/shop')).toBe('shop');
		c.dropRepo('own/docs');
		expect(c.repos()).toHaveLength(1);
	});

	it('says the connection was cancelled when the popup closes first, and nothing when nothing was pending', () => {
		const { c } = make();
		c.addRepo(box('own/shop'), box(''));
		c.connect('own/shop', 'another');
		expect(c.showSignIn()).toBe(true);
		expect(repo(c, 'own/shop')?.link).toBe('checking');
		c.afterClose(false);
		expect(c.notice()).toBe('GitHub connection cancelled.');
		expect(repo(c, 'own/shop')?.link).toBe('idle');
		c.notice.set('');
		c.afterClose(false);
		expect(c.notice()).toBe('');
		c.connect('own/shop');
		c.afterClose(true);
		expect(c.notice()).toBe('');
	});

	it('turns a reachable repository green, takes its new name, suggests branches and reads the menus file', async () => {
		const { c, api } = make();
		c.addRepo(box('own/shop'), box(''));
		expect(c.waitingFor('own/shop')).toBe('Connect it on Repositories first');
		await c.loadBranches('own/shop');
		expect(api.repositoryBranches).not.toHaveBeenCalled();
		api.githubCheck.mockResolvedValueOnce({
			signedIn: true,
			account: 'owner',
			reachable: true,
			fullName: 'own/Shop2',
		});
		c.connect('own/shop');
		await c.afterSignIn();
		await vi.waitFor(() => expect(c.listOf('own/shop')).toBeTruthy());
		await vi.waitFor(() => expect(repo(c, 'own/shop')?.file).toContain('from .release-console.json on dev'));
		expect(repo(c, 'own/shop')).toMatchObject({ link: 'connected', renamedTo: 'own/Shop2' });
		expect(repo(c, 'own/shop')?.file).toContain('2 parts described');
		expect(repo(c, 'own/shop')?.file).toContain('1 line(s) not used: bad line');
		expect(repo(c, 'own/shop')?.menus).toEqual(['overview']);
		expect(c.envs().map((e) => e.branches['own/shop'])).toEqual(['dev', 'staging', 'main']);
		expect(c.branchesOf('own/shop')).toHaveLength(3);
		expect(c.branchesOf('own/none')).toEqual([]);
		expect(c.waitingFor('own/shop')).toBe('loading branches…');
		c.useNewName('own/shop', 'own/Shop2');
		await vi.waitFor(() => expect(repo(c, 'own/Shop2')?.file).not.toBe('reading…'));
		expect(api.repositoryFile).toHaveBeenLastCalledWith({ vendor: 'github', repository: 'own/Shop2' });
	});

	it('reads branches again on request, shows it is fetching, and keeps the error as the list note', async () => {
		const { c, api } = make();
		c.addRepo(box('own/shop'), box(''));
		c.connect('own/shop');
		await c.afterSignIn();
		await vi.waitFor(() => expect(c.listOf('own/shop')).toBeTruthy());
		let fail: (error: Error) => void = () => undefined;
		api.repositoryBranches.mockImplementationOnce(
			() => new Promise((_resolve, reject) => (fail = reject as (error: Error) => void)),
		);
		const loading = c.loadBranches('own/shop', true);
		expect(c.waitingFor('own/shop')).toBe('fetching branches…');
		fail(new Error('git fetch failed'));
		await loading;
		expect(c.waitingFor('own/shop')).toBe('git fetch failed');
	});

	it('reads the menus file from the branch the first local environment uses, and says why it could not', async () => {
		const { c, api, own } = make();
		c.addRepo(box('own/shop'), box(''));
		c.connect('own/shop');
		await c.afterSignIn();
		await vi.waitFor(() => expect(c.listOf('own/shop')).toBeTruthy());
		const fileAfter = async (answer: unknown, branch: string) => {
			api.repositoryFile.mockResolvedValueOnce(answer);
			c.setBranch(0, 'own/shop', branch);
			await vi.waitFor(() => expect(repo(c, 'own/shop')?.file).not.toBe('reading…'));
			return repo(c, 'own/shop')?.file;
		};
		expect(await fileAfter({ state: 'not-connected' }, 'main')).toBe('Connect to read them.');
		expect(await fileAfter({ state: 'failed', message: 'GitHub is down' }, 'staging')).toBe('GitHub is down');
		expect(await fileAfter({ state: 'ok', data: { found: false } }, 'dev')).toContain(
			'no .release-console.json on dev',
		);
		expect(
			await fileAfter({ state: 'ok', data: { found: true, menus: [], manifest: null, problems: [] } }, 'main'),
		).toBe('from .release-console.json on main: none');
		api.repositoryFile.mockRejectedValueOnce(new Error('no network'));
		c.setBranch(0, 'own/shop', 'staging');
		await vi.waitFor(() => expect(repo(c, 'own/shop')?.file).toBe('no network'));
		// A branch change on another environment leaves the menus file alone.
		const calls = api.repositoryFile.mock.calls.length;
		c.setBranch(1, 'own/shop', 'main');
		expect(api.repositoryFile.mock.calls.length).toBe(calls);
		await own['readFile']?.('own/shop');
		expect(api.repositoryFile).toHaveBeenLastCalledWith({ vendor: 'github', repository: 'own/shop' });
	});

	it('marks a repository failed when GitHub does not answer as signed in, or the check fails', async () => {
		const { c, api, own } = make();
		c.addRepo(box('own/shop'), box(''));
		api.githubCheck.mockResolvedValueOnce({
			signedIn: false,
			account: null,
			reachable: false,
			message: '',
		} as never);
		await own['check']?.('own/shop');
		expect(repo(c, 'own/shop')).toMatchObject({ link: 'failed' });
		api.githubCheck.mockResolvedValueOnce({
			signedIn: true,
			account: 'other',
			reachable: false,
			message: 'No access',
		} as never);
		await own['check']?.('own/shop');
		api.githubCheck.mockRejectedValueOnce(new Error('gh missing'));
		await own['check']?.('own/shop');
		await c.afterSignIn();
		expect(api.githubCheck).toHaveBeenCalledTimes(3);
	});
});

describe('add project: environments, platforms, menus and the steps', () => {
	it('adds and drops environments, and refuses a cloud an environment runs on', () => {
		const { c } = make();
		c.addEnv(box('  '));
		c.addEnv(box('Local'));
		expect(c.envs()).toHaveLength(3);
		c.addEnv(box('QA Lab'));
		expect(c.envs()[3]?.name).toBe('qa-lab');
		c.setRunsOn(3, 'aws');
		expect(c.usedBy('aws')).toBe('QA Lab');
		c.toggleCloud('aws');
		expect(c.message()).toMatch(/QA Lab runs on .* Move it on Environments first\./);
		c.toggleCloud('digitalocean');
		expect(c.message()).toMatch(/run on .* Move them on Environments first\./);
		c.toggleCloud('gcp');
		expect(c.extraClouds().has('gcp')).toBe(true);
		c.toggleCloud('gcp');
		expect(c.extraClouds().has('gcp')).toBe(false);
		c.dropEnv(3);
		expect(c.envs()).toHaveLength(3);
	});

	it('ticks edge platforms and secrets managers, and clears an environment’s manager when it is unticked', () => {
		const { c } = make();
		const first = c.edgeList()[0]?.vendor as string;
		expect(c.edgeOn(first)).toBe(true);
		c.toggleEdge(first);
		expect(c.edgeOn(first)).toBe(false);
		c.toggleEdge(first);
		c.setZones(0, 'example.com');
		expect(c.edgeList()[0]?.zones).toBe('example.com');
		c.toggleSecrets('infisical');
		expect(c.secretsOn('infisical')).toBe(true);
		c.setSecretsAddress(0, ' https://vault.example.com ');
		c.setSecretsFrom(0, 'infisical');
		c.setSecretsPath(0, 'saha-textile-local/dev');
		expect(c.managerOf(c.envs()[0])).toBe('infisical');
		c.setSecretsFrom(1, 'none');
		expect(c.managerOf(c.envs()[1])).toBeNull();
		c.toggleSecrets('infisical');
		expect(c.envs()[0]?.secretsFrom).toBeNull();
		expect(c.secretsOn('infisical')).toBe(false);
	});

	it('ticks and unticks a repository’s menus, names menus it does not know by their key, and lists workspaces', () => {
		const { c } = make();
		c.addRepo(box('own/shop'), box(''));
		c.toggleMenu('own/shop', 'overview');
		expect(repo(c, 'own/shop')?.menus).toEqual(['overview']);
		c.toggleMenu('own/shop', 'overview');
		c.toggleMenu('own/other', 'overview');
		expect(repo(c, 'own/shop')?.menus).toEqual([]);
		expect(c.menuLabel('no-such-screen')).toBe('no-such-screen');
		expect(c.menuCaption('no-such-screen')).toBe('');
		expect(c.workspaces()).toEqual([]);
		projects.set({ projects: [], workspaces: ['Saha Textile'] });
		expect(c.workspaces()).toEqual(['Saha Textile']);
	});

	it('keeps Next off until each step is complete, and goes back to the list from the first step', async () => {
		const { c, router } = make();
		expect(c.problem()).toBe('Give the project a name.');
		c.name.set('Bad $ name');
		expect(c.problem()).toMatch(/Use letters/);
		projects.set({ projects: [{ id: 'acme' }], workspaces: [] });
		c.name.set('Acme');
		expect(c.problem()).toBe('A project with that name exists.');
		projects.set(undefined);
		expect(c.problem()).toBe('Choose or name a workspace.');
		await c.next();
		expect(c.at()).toBe(0);
		c.workspace.set('Saha Textile');
		await c.next();
		expect(c.at()).toBe(1);
		expect(c.problem()).toBe('Add at least one repository.');
		c.back();
		expect(c.at()).toBe(0);
		c.back();
		expect(router.navigate).toHaveBeenCalledWith(['/console', 'projects']);
		c.at.set(3);
		expect(c.problem()).toBe('');
		c.at.set(4);
		expect(typeof c.problem()).toBe('string');
		c.at.set(5);
		expect(typeof c.problem()).toBe('string');
		c.at.set(STEPS.length - 1);
		expect(c.nextLabel()).toBe('Add project');
		c.at.set(0);
		expect(c.nextLabel()).toMatch(/^Next: /);
	});

	it('adds the project, links the GitHub sign-in to its GitHub repositories, and opens Connections', async () => {
		const { c, api, router, queries } = make();
		c.name.set('Acme');
		c.workspace.set('Saha Textile');
		c.addRepo(box('own/shop'), box(''));
		c.repoVendor.set('gitlab');
		c.addRepo(box('own/docs'), box(''));
		c.connect('own/shop');
		await c.afterSignIn();
		await vi.waitFor(() => expect(c.listOf('own/shop')).toBeTruthy());
		c.at.set(STEPS.length - 1);
		await c.next();
		const draft = c.draft();
		expect(draft.repositories[0]?.environments[0]?.branch).toBe('dev');
		expect(draft.repositories[1]?.environments[0]?.branch).toBe('');
		if (api.addProject.mock.calls.length) {
			expect(api.linkKey).toHaveBeenCalled();
			expect(api.setSlotKeys).toHaveBeenCalledWith('acme', expect.objectContaining({ repositoryId: 'shop' }));
			expect(queries.invalidateQueries).toHaveBeenCalled();
			expect(router.navigate).toHaveBeenCalledWith(['/p', 'acme', 'settings'], {
				queryParams: { tab: 'connections' },
			});
			api.linkKey.mockRejectedValueOnce(new Error('no key'));
			api.addProject.mockRejectedValueOnce(new Error('Name taken'));
			await c.next();
			expect(c.message()).toBe('Name taken');
		} else {
			// The draft the steps allowed still breaks the project's own shape: the page names each problem.
			expect(c.message()).toContain(':');
		}
	});

	it('adds a project with no connected GitHub repository without linking a key, and names a link failure nowhere', async () => {
		const { c, api, own } = make();
		await own['linkCliSignIn']?.('acme');
		expect(api.linkKey).not.toHaveBeenCalled();
		c.addRepo(box('own/shop'), box(''));
		c.connect('own/shop');
		await c.afterSignIn();
		api.linkKey.mockRejectedValueOnce(new Error('no key'));
		await expect(own['linkCliSignIn']?.('acme')).resolves.toBeUndefined();
	});
});

describe('the secrets place note', () => {
	it('reads an older place written with a dot or a bar', () => {
		expect(placeNote('infisical', 'saha-textile-local · Development')).toContain('Reads project');
		expect(placeNote('infisical', 'saha-textile-local/dev/api')).toContain('only /api');
	});
});

describe('add project: the step checks and the draft', () => {
	const env = (name: string, runsOn: string | null) => ({ name, runsOn }) as never;
	const list = (names: string[], defaultBranch: string | null, current: string | null = null) =>
		({
			defaultBranch,
			current,
			branches: names.map((name) => ({ name, onGitHub: true, onThisComputer: false })),
			note: '',
		}) as never;

	it('suggests no branch for production without a default, and the default for a local environment', () => {
		expect(suggestBranch(env('production', 'digitalocean'), list(['dev'], null))).toBe('');
		expect(suggestBranch(env('qa', null), list(['main'], 'main', 'gone'))).toBe('main');
		expect(suggestBranch(env('qa', 'digitalocean'), list(['main'], 'main'))).toBe('');
	});

	it('names a zone that is not a domain, a repository with no branches, and a manager with no address', () => {
		const server = [{ label: 'Staging', runsOn: 'digitalocean', domains: 'staging.example.com' }] as never;
		expect(edgeProblem(server, [{ vendor: 'cloudflare', zones: 'bad!name.com' }] as never)).toContain(
			'is not a domain name',
		);
		const repos = [{ repository: 'own/shop', connected: true }];
		expect(
			branchProblem([], repos, {
				'own/shop': { ...(list([], null) as object), note: 'GitHub is down' },
			} as never),
		).toBe('GitHub is down');
		expect(branchProblem([], repos, { 'own/shop': list([], null) })).toBe(
			'own/shop has no branches to choose from.',
		);
		expect(secretsProblem([], [{ vendor: 'vault', address: 'vault.local' }] as never)).toContain(
			'starting with https://',
		);
	});

	it('reads branches again without changing a chosen branch or the menus file', async () => {
		const { c, api } = make();
		c.addRepo(box('own/shop'), box(''));
		c.connect('own/shop');
		await c.afterSignIn();
		await vi.waitFor(() => expect(c.listOf('own/shop')).toBeTruthy());
		await vi.waitFor(() => expect(repo(c, 'own/shop')?.file).not.toBe('reading…'));
		const reads = api.repositoryFile.mock.calls.length;
		await c.loadBranches('own/shop', true);
		expect(c.envs().map((e) => e.branches['own/shop'])).toEqual(['dev', 'staging', 'main']);
		expect(api.repositoryFile.mock.calls.length).toBe(reads);
	});

	it('writes each manager into the draft with its address only where it needs one, and checks steps 1 and 2', () => {
		const { c } = make();
		c.addRepo(box('own/shop'), box(''));
		c.toggleSecrets('infisical');
		c.toggleSecrets('vault');
		c.setSecretsAddress(1, 'https://vault.example.com');
		c.setSecretsFrom(0, 'infisical');
		c.setSecretsFrom(1, 'none');
		const draft = c.draft() as unknown as {
			repositories: Array<{
				environments: Array<{ secretsId: string | null }>;
				secrets: Array<{ vendor: string; address: string }>;
			}>;
		};
		expect(draft.repositories[0]?.environments.map((e) => e.secretsId)).toEqual(['infisical', null, null]);
		expect(draft.repositories[0]?.secrets).toEqual([
			{ id: 'infisical', vendor: 'infisical', address: '', keyIds: [] },
			{ id: 'vault', vendor: 'vault', address: 'https://vault.example.com', keyIds: [] },
		]);
		c.at.set(1);
		expect(c.problem()).toBe('');
		c.at.set(2);
		expect(c.problem()).not.toBe('');
		c.setDomains(1, 'staging.example.com');
		c.setDomains(2, 'example.com');
		expect(c.problem()).toBe('Connect own/shop on Repositories to choose its branches.');
	});

	it('names each problem in the draft when the project’s own shape refuses it', async () => {
		const { c, api } = make();
		c.at.set(STEPS.length - 1);
		await c.next();
		expect(api.addProject).not.toHaveBeenCalled();
		expect(c.message()).toContain(':');
	});
});
