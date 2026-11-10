import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service.js';
import { SAHA_TEXTILE } from './saha-textile.fixture.js';
import { VendorReadsService } from './vendor-reads.service.js';
import { KeychainPort } from '../keychain/keychain.port.js';
import { ConsoleStore } from '../store/console-store.js';

/** An in-memory Keychain for tests only. */
class MemoryKeychain extends KeychainPort {
	readonly items = new Map<string, string>();
	async set(account: string, value: string): Promise<void> {
		this.items.set(account, value);
	}
	async get(account: string): Promise<string | null> {
		return this.items.get(account) ?? null;
	}
	async remove(account: string): Promise<void> {
		this.items.delete(account);
	}
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('projects and keys', () => {
	let dir: string;
	let keychain: MemoryKeychain;
	let projects: ProjectsService;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'release-console-projects-'));
		process.env['CONSOLE_DATA_DIR'] = dir;
		keychain = new MemoryKeychain();
		projects = new ProjectsService(new ConsoleStore(), keychain);
		projects.add(SAHA_TEXTILE);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env['CONSOLE_DATA_DIR'];
	});

	it('starts empty, even beside a .release-console.json; the owner adds every project', () => {
		const fresh = new ProjectsService(new ConsoleStore(), new MemoryKeychain());
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-empty-'));
		expect(new ProjectsService(new ConsoleStore(), new MemoryKeychain()).view()).toEqual({
			workspaces: [],
			projects: [],
		});
		expect(fresh.view().projects.map((p) => p.id)).toEqual(['saha-textile']);
	});

	it('stores a key in the Keychain only, checks it, and never returns the value', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				json({ account: { email: 'owner@example.com', status: 'active', team: { name: 'Kaizer Systems' } } }),
			),
		);
		const ref = await projects.storeKey('saha-textile', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			value: 'test-value-1',
			expiresAt: null,
			note: '',
			target: '',
		});
		expect(ref).toMatchObject({
			state: 'verified',
			account: 'Kaizer Systems',
			keychainItem: 'Saha Textile · do-read',
		});
		expect(keychain.items.get('Saha Textile · do-read')).toBe('test-value-1');
		expect(JSON.stringify(projects.view())).not.toContain('test-value-1');
		expect(readFileSync(join(dir, 'console.json'), 'utf8')).not.toContain('test-value-1');
	});

	it('answers not connected until a slot has a key, then reads with it', async () => {
		const reads = new VendorReadsService(projects);
		expect((await reads.droplets('saha-textile', 'saha-textile', 'digitalocean')).state).toBe('not-connected');
		const fetch = vi.fn(async (url: string) =>
			url.endsWith('/account')
				? json({ account: { email: 'owner@example.com' } })
				: json({
						droplets: [
							{
								id: 1,
								name: 'staging-1',
								status: 'active',
								region: { slug: 'blr1' },
								size_slug: 's-2vcpu-4gb',
								vcpus: 2,
								memory: 4096,
								disk: 80,
								networks: { v4: [{ type: 'public', ip_address: '203.0.113.5' }] },
								tags: ['env:staging'],
								created_at: '2026-11-10T00:00:00Z',
							},
						],
					}),
		);
		vi.stubGlobal('fetch', fetch);
		await projects.storeKey('saha-textile', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			value: 'test-value-2',
			expiresAt: null,
			note: '',
			target: '',
		});
		projects.setSlotKeys('saha-textile', {
			repositoryId: 'saha-textile',
			slot: 'cloud',
			slotId: 'digitalocean',
			keyIds: ['do-read'],
		});
		const answer = await reads.droplets('saha-textile', 'saha-textile', 'digitalocean');
		expect(answer).toMatchObject({
			state: 'ok',
			data: [{ name: 'staging-1', ipv4: '203.0.113.5', region: 'blr1' }],
		});
		const call = fetch.mock.calls.at(-1) as unknown as [string, RequestInit];
		expect((call[1].headers as Record<string, string>)['authorization']).toBe('Bearer test-value-2');
	});

	it('refuses DNS reads for a zone that is not the slot’s', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				json({
					success: true,
					result: [{ id: 'z1', name: 'sahatextile.com', account: { id: 'a1', name: 'Second' } }],
				}),
			),
		);
		await projects.storeKey('saha-textile', {
			id: 'cf-read',
			kind: 'cf-read',
			label: 'Cloudflare API · read',
			value: 'test-value-3',
			expiresAt: null,
			note: '',
			target: '',
		});
		projects.setSlotKeys('saha-textile', {
			repositoryId: 'saha-textile',
			slot: 'edge',
			slotId: 'cloudflare',
			keyIds: ['cf-read'],
		});
		const reads = new VendorReadsService(projects);
		expect(await reads.records('saha-textile', 'saha-textile', 'cloudflare', 'example.com')).toMatchObject({
			state: 'error',
		});
	});

	it('removing a project deletes its Keychain items and no other project’s', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({ account: {} })),
		);
		projects.add({
			id: 'client-shop',
			name: 'Client shop',
			workspace: 'Clients',
			repositories: [
				{
					id: 'shop-web',
					name: 'shop-web',
					role: '',
					sourceCode: { vendor: 'gitlab', repository: 'acme/shop-web', keyId: null },
					environments: [{ name: 'local', label: 'Local', cloudId: null, domains: [] }],
					cloud: [],
					edge: [],
					menus: [],
				},
			],
		});
		await projects.storeKey('client-shop', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			value: 'test-value-4',
			expiresAt: null,
			note: '',
			target: '',
		});
		await projects.storeKey('saha-textile', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			value: 'test-value-5',
			expiresAt: null,
			note: '',
			target: '',
		});
		await projects.remove('client-shop');
		expect([...keychain.items.keys()]).toEqual(['Saha Textile · do-read']);
		expect(projects.view().projects.map((p) => p.id)).toEqual(['saha-textile']);
	});

	it('refuses a duplicate project and a key id that is unknown to a slot', () => {
		expect(() => projects.add({ ...projects.project('saha-textile') })).toThrow(/exists/);
		expect(() =>
			projects.setSlotKeys('saha-textile', {
				repositoryId: 'saha-textile',
				slot: 'cloud',
				slotId: 'digitalocean',
				keyIds: ['nope'],
			}),
		).toThrow(/No key/);
	});
});
