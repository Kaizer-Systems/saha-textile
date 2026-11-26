import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { Connections, keyPill } from './connections';
import { ConsoleApi } from '../data/console-api';
import { ConfirmDialog } from '../shared/confirm-dialog';

import type { KeyRef, Project } from '@saha-textile/release-console-contracts';

/** The page's members these tests use (protected on the component). */
interface Page {
	kind: WritableSignal<string>;
	picked: WritableSignal<Set<string>>;
	busy: () => boolean;
	message: () => string;
	formMessage: () => string;
	kindVendor: () => string;
	nextId: () => string;
	slotChoices: () => Array<{ id: string; label: string }>;
	cloudRows: () => Array<{ keys: string; pill: { text: string } }>;
	edgeRows: () => Array<{ zones: string; pill: { text: string } }>;
	secretsRows: () => Array<{ vendor: string; runs: string; envs: string }>;
	keyById(id: string | null): KeyRef | undefined;
	pillOf(ref: KeyRef | undefined): { text: string };
	choose(k: string): void;
	toggle(id: string): void;
	save(e: Event): Promise<void>;
	check(keyId: string): Promise<void>;
	remove(k: KeyRef): Promise<void>;
}

const key = (id: string, state: KeyRef['state'], over: Partial<KeyRef> = {}): KeyRef => ({
	id,
	kind: 'do-read',
	label: `Key ${id}`,
	envNames: [],
	account: '',
	rights: [],
	expiresAt: '2026-12-01T00:00:00.000Z',
	checkedAt: null,
	state,
	note: '',
	target: '',
	...over,
});
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
const PROJECT = {
	id: 'proj_1',
	name: 'Saha Textile',
	keys: [key('do-read', 'failed'), key('do-read-2', 'verified'), key('cf-read', 'expired')],
	repositories: [
		{
			id: 'shop',
			name: 'shop',
			sourceCode: { vendor: 'github', repository: 'own/shop', keyId: null },
			environments: [
				env('local', { secretsId: 'inf', secretsPath: 'p/dev' }),
				env('staging', { secretsId: 'inf' }),
			],
			cloud: [
				{ id: 'do', vendor: 'digitalocean', account: '', keyIds: ['do-read', 'do-read-2', 'gone'] },
				{ id: 'aws', vendor: 'aws', account: '', keyIds: [] },
			],
			edge: [
				{ id: 'cf', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: ['cf-read'] },
				{ id: 'cf2', vendor: 'cloudflare', account: '', zones: [], keyIds: [] },
				{ id: 'fastly', vendor: 'fastly', account: '', zones: [], keyIds: [] },
			],
			secrets: [
				{ id: 'inf', vendor: 'infisical', address: '', keyIds: [] },
				{ id: 'gh', vendor: 'github-secrets', address: '', keyIds: [] },
				{ id: 'files', vendor: 'server-files', address: '', keyIds: [] },
				{ id: 'vault', vendor: 'vault', address: 'https://vault.example.com', keyIds: [] },
			],
			menus: [],
		},
		{
			id: 'docs',
			name: 'docs',
			sourceCode: { vendor: 'gitlab', repository: 'own/docs', keyId: null },
			environments: [env('local')],
			cloud: [],
			edge: [],
			secrets: [],
			menus: [],
		},
	],
} as unknown as Project;

function make() {
	const api = {
		keySource: vi.fn(async () => ({ state: 'ok' })),
		linkKey: vi.fn(async (_projectId: string, _body: unknown) =>
			key('new', 'verified', { label: 'New key', note: 'all good' }),
		),
		setSlotKeys: vi.fn(async (_projectId: string, _body: unknown) => undefined),
		checkKey: vi.fn(async () => key('do-read', 'expiring', { label: 'DO read', note: '' })),
		removeKey: vi.fn(async () => undefined),
	};
	const confirm = { ask: vi.fn(async () => true) };
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(client, 'invalidateQueries');
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(client),
			{ provide: ConsoleApi, useValue: api },
			{ provide: ConfirmDialog, useValue: confirm },
		],
	});
	TestBed.overrideComponent(Connections, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Connections);
	fixture.componentRef.setInput('project', PROJECT);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Page, api, confirm, invalidate };
}

/** A form with the link-a-key boxes, as the submit event hands it over. */
function form(values: Record<string, string>) {
	const element = document.createElement('form');
	for (const [name, value] of Object.entries(values)) {
		const input = document.createElement('input');
		input.name = name;
		input.value = value;
		element.append(input);
	}
	return { preventDefault: vi.fn(), target: element } as unknown as Event;
}
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('a key’s pill', () => {
	it('words every state, and no key as not connected', () => {
		expect(keyPill(undefined).text).toBe('not connected');
		expect(keyPill(key('k', 'verified')).text).toBe('connected');
		expect(keyPill(key('k', 'expiring')).text).toBe('expires 2026-12-01');
		expect(keyPill(key('k', 'expired'))).toEqual({ cls: 'red', text: 'expired' });
		expect(keyPill(key('k', 'failed')).text).toBe('check failed');
		expect(keyPill(key('k', 'unchecked')).text).toBe('unchecked');
	});
});

describe('Project settings › Connections', () => {
	it('numbers a new key after the ones the project has, and lists the slots a kind of key fits', async () => {
		const { c } = make();
		expect(c.nextId()).toBe('do-read-3');
		expect(c.kindVendor()).toBe('digitalocean');
		await settle();
		expect([...c.picked()]).toEqual(['shop:c:do']);
		c.choose('github-cli');
		await settle();
		expect(c.slotChoices().map((s) => s.id)).toEqual(['shop:sc']);
		c.choose('cf-read');
		await settle();
		expect(c.slotChoices().map((s) => s.label)).toEqual([
			'shop · Cloudflare (example.com)',
			'shop · Cloudflare (no domain)',
		]);
		c.choose('service-key');
		await settle();
		expect(c.kindVendor()).toBe('github');
		expect(c.slotChoices()).toEqual([]);
		c.toggle('x');
		expect(c.picked().has('x')).toBe(true);
		c.toggle('x');
		expect(c.picked().has('x')).toBe(false);
	});

	it('shows each slot’s keys and its best key’s state, and screens later for vendors without screens', () => {
		const { c } = make();
		const [digitalocean, aws] = c.cloudRows();
		expect(digitalocean?.keys).toBe('Key do-read · Key do-read-2 · gone');
		expect(digitalocean?.pill.text).toBe('connected');
		expect(aws).toMatchObject({ keys: '—', pill: { text: 'screens later' } });
		const [cloudflare, bare, fastly] = c.edgeRows();
		expect(cloudflare).toMatchObject({ zones: 'example.com', pill: { text: 'expired' } });
		expect(bare).toMatchObject({ zones: '—', pill: { text: 'not connected' } });
		expect(fastly?.pill.text).toBe('screens later');
		expect(c.secretsRows().map((r) => [r.vendor, r.runs, r.envs])).toEqual([
			['infisical', 'managed service', 'LOCAL (p/dev), STAGING'],
			['github-secrets', 'inside the source-code vendor', 'none yet'],
			['server-files', 'on the server', 'none yet'],
			['vault', 'https://vault.example.com', 'none yet'],
		]);
		expect(c.keyById(null)).toBeUndefined();
		expect(c.pillOf(c.keyById('do-read-2')).text).toBe('connected');
	});

	it('asks for the variable name, a proper Infisical name and a region/bucket before linking', async () => {
		const { c, api } = make();
		await c.save(form({ env0: '', env1: '' }));
		expect(c.formMessage()).toBe('Name the Infisical variable that holds this key.');
		await c.save(form({ env0: 'bad-name' }));
		expect(c.formMessage()).toContain('is not an Infisical name');
		c.choose('spaces-key');
		await c.save(form({ env0: 'SPACES_KEY', target: 'nowhere' }));
		expect(c.formMessage()).toContain('region/bucket');
		expect(api.linkKey).not.toHaveBeenCalled();
	});

	it('links a key, sets it on the picked slots, and says how the vendor checked it', async () => {
		const { c, api, invalidate } = make();
		c.choose('github-token');
		await settle();
		await c.save(form({ env0: 'GITHUB_TOKEN', expires: '2026-12-31' }));
		expect(api.linkKey).toHaveBeenCalledWith(
			'proj_1',
			expect.objectContaining({ id: 'github-token', envNames: ['GITHUB_TOKEN'], expiresAt: expect.any(String) }),
		);
		expect(api.setSlotKeys).toHaveBeenCalledWith(
			'proj_1',
			expect.objectContaining({ slot: 'source-code', keyIds: ['github-token'] }),
		);
		expect(c.formMessage()).toBe('New key: connected · all good');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects'] });
		c.choose('do-change');
		await settle();
		api.linkKey.mockResolvedValueOnce(key('do-change', 'unchecked', { label: 'DO change' }));
		await c.save(form({ env0: 'DO_TOKEN' }));
		expect(api.setSlotKeys).toHaveBeenLastCalledWith(
			'proj_1',
			expect.objectContaining({ slot: 'cloud', keyIds: ['do-read', 'do-read-2', 'gone', 'do-change'] }),
		);
		expect(c.formMessage()).toBe('DO change: unchecked');
		c.choose('github-cli');
		await settle();
		api.linkKey.mockRejectedValueOnce(new Error('Not in Infisical'));
		await c.save(form({}));
		expect(c.formMessage()).toBe('Not in Infisical');
		expect(c.busy()).toBe(false);
	});

	it('checks a key again and unlinks one after asking, saying when either fails', async () => {
		const { c, api, confirm } = make();
		await c.check('do-read');
		expect(c.message()).toBe('DO read: expires 2026-12-01');
		api.checkKey.mockResolvedValueOnce(key('do-read', 'failed', { label: 'DO read', note: 'token revoked' }));
		await c.check('do-read');
		expect(c.message()).toBe('DO read: check failed · token revoked');
		api.checkKey.mockRejectedValueOnce(new Error('offline'));
		await c.check('do-read');
		expect(c.message()).toBe('offline');
		const ref = PROJECT.keys[0] as KeyRef;
		confirm.ask.mockResolvedValueOnce(false);
		await c.remove(ref);
		expect(api.removeKey).not.toHaveBeenCalled();
		await c.remove(ref);
		expect(c.message()).toBe('Key do-read unlinked; it stays in Infisical.');
		api.removeKey.mockRejectedValueOnce(new Error('in use'));
		await c.remove(ref);
		expect(c.message()).toBe('in use');
	});
});
