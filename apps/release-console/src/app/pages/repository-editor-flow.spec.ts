import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryEditor, newRepository, toggleSecretsSlot } from './repository-editor';
import { ConsoleApi } from '../data/console-api';
import { ConfirmDialog } from '../shared/confirm-dialog';

import type { Project, Repository } from '@saha-textile/release-console-contracts';

/** The editor's members these tests use (protected on the component). */
interface Editor {
	draft: WritableSignal<Repository | null>;
	newVendor: WritableSignal<string>;
	branchList: () => { note: string; branches: unknown[] } | null;
	fetchingBranches: () => boolean;
	message: WritableSignal<string>;
	busy: () => boolean;
	readBranches(repository: string, refresh?: boolean): Promise<void>;
	secretsOf(r: Repository): string;
	envLabels(r: Repository): string;
	cloudsOf(r: Repository): string;
	edgesOf(r: Repository): string;
	menuLabel(key: string): string;
	menuCaption(key: string): string;
	edit(id: string): void;
	cancel(): void;
	patch(change: Partial<Repository>): void;
	setEnv(i: number, change: object): void;
	addEnv(box: HTMLInputElement): void;
	dropEnv(i: number): void;
	hasCloud(v: string): boolean;
	toggleCloud(v: string): void;
	hasEdge(v: string): boolean;
	toggleEdge(v: string): void;
	hasSecrets(v: string): boolean;
	toggleSecrets(v: string): void;
	setSecretsAddress(i: number, text: string): void;
	setZones(i: number, text: string): void;
	toggleMenu(m: string): void;
	save(): Promise<void>;
	remove(): Promise<void>;
	add(box: HTMLInputElement, role: HTMLInputElement): Promise<void>;
}

const env = (name: string, over: object = {}) => ({
	name,
	label: name[0]?.toUpperCase() + name.slice(1),
	cloudId: null,
	domains: [],
	secretsId: null,
	secretsPath: '',
	branch: '',
	...over,
});
const SHOP: Repository = {
	id: 'shop',
	name: 'shop',
	role: 'monorepo',
	sourceCode: { vendor: 'github', repository: 'own/shop', keyId: null },
	environments: [env('local'), env('staging', { cloudId: 'digitalocean', secretsId: 'infisical' })],
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
	edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: [] }],
	secrets: [{ id: 'infisical', vendor: 'infisical', address: '', keyIds: [] }],
	menus: ['overview'],
} as Repository;
const DOCS: Repository = {
	...SHOP,
	id: 'docs',
	name: 'docs',
	sourceCode: { vendor: 'gitlab', repository: 'own/docs', keyId: null },
	environments: [env('local')],
	cloud: [],
	edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: [], keyIds: [] }],
	secrets: [],
} as Repository;
const PROJECT = { id: 'proj_1', name: 'Saha Textile', repositories: [SHOP, DOCS] } as unknown as Project;

function make(open?: string) {
	const api = {
		repositoryBranches: vi.fn(async () => ({ defaultBranch: 'main', current: null, branches: [], note: '' })),
		repositoryFile: vi.fn(
			async () => ({ state: 'ok', data: { menus: ['overview', 'unknown-screen'] } }) as unknown,
		),
		updateRepository: vi.fn(async () => undefined),
		removeRepository: vi.fn(async () => undefined),
		addRepository: vi.fn(async () => undefined),
	};
	const router = { navigate: vi.fn(async () => true) };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	const confirm = { ask: vi.fn(async () => true) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: router },
			{ provide: QueryClient, useValue: queries },
			{ provide: ConfirmDialog, useValue: confirm },
		],
	});
	TestBed.overrideComponent(RepositoryEditor, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(RepositoryEditor);
	fixture.componentRef.setInput('project', PROJECT);
	if (open) fixture.componentRef.setInput('open', open);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Editor, api, router, queries, confirm, fixture };
}
const box = (value: string) => Object.assign(document.createElement('input'), { value });

describe('repository helpers: the rest', () => {
	it('adds and removes a secrets manager, moving its environments back to no manager', () => {
		const added = toggleSecretsSlot(DOCS, 'vault');
		expect(added.secrets.map((x) => x.vendor)).toEqual(['vault']);
		const removed = toggleSecretsSlot(SHOP, 'infisical');
		expect(removed.secrets).toEqual([]);
		expect(removed.environments.map((e) => e.secretsId)).toEqual([null, null]);
	});

	it('starts a first repository with one local environment and no platforms', () => {
		const first = newRepository(undefined, 'github', 'own/first', 'site', []);
		expect(first).toMatchObject({ id: 'first', cloud: [], edge: [], secrets: [] });
		expect(first.environments.map((e) => e.name)).toEqual(['local']);
	});
});

describe('repository editor: one repository at a time', () => {
	it('opens the repository named in the address, reading a GitHub repository’s branches', async () => {
		const { c, api, fixture } = make('shop');
		expect(c.draft()?.id).toBe('shop');
		await vi.waitFor(() => expect(c.branchList()).not.toBeNull());
		expect(api.repositoryBranches).toHaveBeenCalledWith('own/shop', false);
		api.repositoryBranches.mockRejectedValueOnce(new Error('gh missing'));
		await c.readBranches('own/shop', true);
		expect(c.branchList()?.note).toBe('gh missing');
		expect(c.fetchingBranches()).toBe(false);
		// The same repository again leaves the draft as it is.
		c.patch({ role: 'changed' });
		fixture.componentRef.setInput('open', 'shop');
		fixture.detectChanges();
		expect(c.draft()?.role).toBe('changed');
		fixture.componentRef.setInput('open', 'docs');
		fixture.detectChanges();
		expect(c.draft()?.id).toBe('docs');
		expect(api.repositoryBranches).toHaveBeenCalledTimes(2);
	});

	it('words each repository’s platforms, and names menus it does not know by their key', () => {
		const { c } = make();
		expect(c.draft()).toBeNull();
		expect(c.secretsOf(SHOP)).toContain('Infisical');
		expect(c.secretsOf(DOCS)).toBe('no manager');
		expect(c.cloudsOf(DOCS)).toBe('this computer only');
		expect(c.edgesOf(SHOP)).toContain('(example.com)');
		expect(c.edgesOf({ ...DOCS, edge: [] })).toBe('—');
		expect(c.envLabels(SHOP)).toBe('Local · Staging');
		expect(c.menuLabel('no-such-screen')).toBe('no-such-screen');
		expect(c.menuCaption('no-such-screen')).toBe('');
	});

	it('changes nothing while no repository is open', () => {
		const { c } = make();
		c.patch({ role: 'x' });
		c.setEnv(0, { label: 'x' });
		c.addEnv(box('QA'));
		c.dropEnv(0);
		expect(c.message()).toBe('A repository keeps at least one environment.');
		c.toggleCloud('aws');
		c.toggleEdge('fastly');
		c.toggleSecrets('vault');
		c.setSecretsAddress(0, 'x');
		c.setZones(0, 'x');
		c.toggleMenu('overview');
		expect(c.draft()).toBeNull();
		expect(c.hasCloud('aws')).toBe(false);
		expect(c.hasEdge('fastly')).toBe(false);
		expect(c.hasSecrets('vault')).toBe(false);
	});

	it('edits environments, platforms and menus of the open repository', () => {
		const { c, router } = make();
		c.edit('none');
		expect(c.draft()).toBeNull();
		c.edit('shop');
		expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { tab: 'repositories', repo: 'shop' } });
		c.setEnv(1, { label: 'Stage' });
		expect(c.draft()?.environments[1]?.label).toBe('Stage');
		c.addEnv(box('  '));
		c.addEnv(box('Local'));
		const qa = box('QA');
		c.addEnv(qa);
		expect(qa.value).toBe('');
		expect(c.draft()?.environments.map((e) => e.name)).toEqual(['local', 'staging', 'qa']);
		c.dropEnv(2);
		expect(c.draft()?.environments).toHaveLength(2);
		c.toggleCloud('aws');
		expect(c.hasCloud('aws')).toBe(true);
		c.toggleEdge('fastly');
		expect(c.hasEdge('fastly')).toBe(true);
		c.toggleSecrets('vault');
		expect(c.hasSecrets('vault')).toBe(true);
		c.setSecretsAddress(1, ' https://vault.example.com ');
		expect(c.draft()?.secrets[1]?.address).toBe('https://vault.example.com');
		c.setZones(1, 'a.example.com, b.example.com');
		expect(c.draft()?.edge[1]?.zones).toEqual(['a.example.com', 'b.example.com']);
		c.toggleMenu('overview');
		expect(c.draft()?.menus).toEqual([]);
		c.toggleMenu('overview');
		expect(c.draft()?.menus).toEqual(['overview']);
		c.cancel();
		expect(c.draft()).toBeNull();
	});

	it('asks for an address before saving a manager that needs one, names the draft’s problems, and saves', async () => {
		const { c, api, queries } = make('shop');
		c.toggleSecrets('vault');
		await c.save();
		expect(c.message()).toContain('starting with https://');
		expect(api.updateRepository).not.toHaveBeenCalled();
		c.setSecretsAddress(1, 'https://vault.example.com');
		c.patch({ name: '' });
		await c.save();
		expect(c.message()).toContain(':');
		c.patch({ name: 'shop' });
		await c.save();
		expect(api.updateRepository).toHaveBeenCalledWith('proj_1', expect.objectContaining({ id: 'shop' }));
		expect(c.message()).toBe('shop saved.');
		expect(queries.invalidateQueries).toHaveBeenCalled();
		api.updateRepository.mockRejectedValueOnce(new Error('Stale project'));
		await c.save();
		expect(c.message()).toBe('Stale project');
		expect(c.busy()).toBe(false);
	});

	it('removes the open repository only after the question is answered yes', async () => {
		const { c, api, confirm } = make();
		await c.remove();
		expect(confirm.ask).not.toHaveBeenCalled();
		c.edit('docs');
		confirm.ask.mockResolvedValueOnce(false);
		await c.remove();
		expect(api.removeRepository).not.toHaveBeenCalled();
		await c.remove();
		expect(api.removeRepository).toHaveBeenCalledWith('proj_1', 'docs');
		expect(c.draft()).toBeNull();
	});

	it('adds a repository in owner/name form, taking a GitHub repository’s own menus when its file has them', async () => {
		const { c, api } = make();
		await c.add(box('not a repo'), box(''));
		expect(c.message()).toBe('Write the repository as owner/name.');
		const name = box('own/new');
		const role = box(' api ');
		await c.add(name, role);
		expect(api.addRepository).toHaveBeenCalledWith(
			'proj_1',
			expect.objectContaining({ menus: ['overview'], role: 'api' }),
		);
		expect(c.message()).toContain('with its own menus from .release-console.json');
		expect(name.value).toBe('');
		api.repositoryFile.mockResolvedValueOnce({ state: 'ok', data: { menus: [] } });
		await c.add(box('own/plain'), box(''));
		expect(c.message()).toBe('plain added. Connect its source code on the Connections tab.');
		api.repositoryFile.mockRejectedValueOnce(new Error('no network'));
		await c.add(box('own/offline'), box(''));
		api.repositoryFile.mockResolvedValueOnce({ state: 'failed', message: 'down' });
		await c.add(box('own/down'), box(''));
		c.newVendor.set('gitlab');
		const calls = api.repositoryFile.mock.calls.length;
		await c.add(box('own/lab'), box(''));
		expect(api.repositoryFile.mock.calls.length).toBe(calls);
		expect(api.addRepository).toHaveBeenLastCalledWith('proj_1', expect.objectContaining({ menus: [] }));
	});
});
