import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service.js';
import { SAHA_TEXTILE } from './saha-textile.fixture.js';
import { VendorReadsService } from './vendor-reads.service.js';
import { KeySourceService } from '../keys/key-source.js';
import { ConsoleStore } from '../store/console-store.js';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const droplet = {
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
};

describe('projects and key links', () => {
	let dir: string;
	let keysFile: string;
	let projects: ProjectsService;
	/** Writes the key file as `pnpm console:env` would, with a new modification time. */
	const writeKeys = (lines: string[]) => {
		writeFileSync(keysFile, `${lines.join('\n')}\n`);
		const t = new Date(Date.now() + Math.random() * 1000);
		utimesSync(keysFile, t, t);
	};
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'release-console-projects-'));
		keysFile = join(dir, 'console.env');
		process.env['CONSOLE_DATA_DIR'] = dir;
		process.env['CONSOLE_KEYS_FILE'] = keysFile;
		projects = new ProjectsService(new ConsoleStore(), new KeySourceService());
		projects.add(SAHA_TEXTILE);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env['CONSOLE_DATA_DIR'];
		delete process.env['CONSOLE_KEYS_FILE'];
	});

	it('starts empty, even beside a .release-console.json; the owner adds every project', () => {
		expect(
			new ProjectsService(new ConsoleStore(), new KeySourceService()).view().projects.map((p) => p.id),
		).toEqual(['saha-textile']);
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-empty-'));
		expect(new ProjectsService(new ConsoleStore(), new KeySourceService()).view()).toEqual({
			workspaces: [],
			projects: [],
		});
	});

	it('links a key by its Infisical name, reads it from the key file, and never stores or returns the value', async () => {
		writeKeys(['CONSOLE_DO_READ_TOKEN=test-value-1']);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				json({ account: { email: 'owner@example.com', status: 'active', team: { name: 'Saha Textile' } } }),
			),
		);
		const ref = await projects.linkKey('saha-textile', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			envNames: [],
			expiresAt: null,
			note: '',
			target: '',
		});
		expect(ref).toMatchObject({ state: 'verified', account: 'Saha Textile', envNames: ['CONSOLE_DO_READ_TOKEN'] });
		expect(JSON.stringify(projects.view())).not.toContain('test-value-1');
		expect(readFileSync(join(dir, 'console.json'), 'utf8')).not.toContain('test-value-1');
	});

	it('fails a link whose name the key file lacks, and recovers when the file gains it', async () => {
		writeKeys(['OTHER=x']);
		const fetch = vi.fn(async () => json({ account: {} }));
		vi.stubGlobal('fetch', fetch);
		const ref = await projects.linkKey('saha-textile', {
			id: 'cf-read',
			kind: 'cf-read',
			label: 'Cloudflare API · read',
			envNames: [],
			expiresAt: null,
			note: '',
			target: '',
		});
		expect(ref).toMatchObject({ state: 'failed', note: expect.stringContaining('CONSOLE_CF_READ_TOKEN') });
		expect(fetch).not.toHaveBeenCalled();
		writeKeys(['CONSOLE_CF_READ_TOKEN=test-value-2']);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url.includes('/zones')
					? json({
							success: true,
							result: [{ name: 'sahatextile.com', account: { id: 'a1', name: 'Second' } }],
						})
					: json({ success: true, result: { status: 'active' } }),
			),
		);
		expect((await projects.checkKeyNow('saha-textile', 'cf-read')).state).toBe('verified');
	});

	it('joins a Spaces key’s two names and refuses one name only', async () => {
		writeKeys(['CONSOLE_SPACES_ACCESS_KEY=TESTACCESS', 'CONSOLE_SPACES_SECRET_KEY=test/secret']);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<ListBucketResult/>', { status: 200 })),
		);
		const ref = await projects.linkKey('saha-textile', {
			id: 'spaces-key',
			kind: 'spaces-key',
			label: 'DigitalOcean Spaces key',
			envNames: [],
			expiresAt: null,
			note: '',
			target: 'sgp1/saha-textile-media',
		});
		expect(ref).toMatchObject({ state: 'verified', account: 'TESTACCESS' });
		await expect(
			projects.linkKey('saha-textile', {
				id: 'spaces-2',
				kind: 'spaces-key',
				label: 'DigitalOcean Spaces key',
				envNames: ['CONSOLE_SPACES_ACCESS_KEY'],
				expiresAt: null,
				note: '',
				target: 'sgp1/saha-textile-media',
			}),
		).rejects.toThrow(/two names/);
	});

	it('answers not connected until a slot has a key, then reads with it', async () => {
		writeKeys(['CONSOLE_DO_READ_TOKEN=test-value-3']);
		const reads = new VendorReadsService(projects);
		expect((await reads.droplets('saha-textile', 'saha-textile', 'digitalocean')).state).toBe('not-connected');
		const fetch = vi.fn(async (url: string) =>
			url.endsWith('/account')
				? json({ account: { email: 'owner@example.com' } })
				: json({ droplets: [droplet] }),
		);
		vi.stubGlobal('fetch', fetch);
		await projects.linkKey('saha-textile', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			envNames: [],
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
		expect((call[1].headers as Record<string, string>)['authorization']).toBe('Bearer test-value-3');
		writeKeys([]);
		expect(await reads.droplets('saha-textile', 'saha-textile', 'digitalocean')).toMatchObject({
			state: 'not-connected',
			message: expect.stringContaining('pnpm console:env'),
		});
	});

	it('refuses DNS reads for a zone that is not the slot’s', async () => {
		writeKeys(['CONSOLE_CF_READ_TOKEN=test-value-4']);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				json({
					success: true,
					result: [{ id: 'z1', name: 'sahatextile.com', account: { id: 'a1', name: 'Second' } }],
				}),
			),
		);
		await projects.linkKey('saha-textile', {
			id: 'cf-read',
			kind: 'cf-read',
			label: 'Cloudflare API · read',
			envNames: [],
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

	it('unlinking a key or removing a project only drops links; slots forget the key', async () => {
		writeKeys(['CONSOLE_DO_READ_TOKEN=test-value-5']);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({ account: {} })),
		);
		await projects.linkKey('saha-textile', {
			id: 'do-read',
			kind: 'do-read',
			label: 'DigitalOcean API · read',
			envNames: [],
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
		await projects.removeKey('saha-textile', 'do-read');
		expect(projects.project('saha-textile').repositories[0]?.cloud[0]?.keyIds).toEqual([]);
		expect(readFileSync(keysFile, 'utf8')).toContain('CONSOLE_DO_READ_TOKEN');
		await projects.remove('saha-textile');
		expect(projects.view().projects).toEqual([]);
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

	it('describes the key file by names only', () => {
		writeKeys(['CONSOLE_DO_READ_TOKEN=test-value-6', 'CONSOLE_CF_WRITE_TOKEN=']);
		const d = new KeySourceService().describe();
		expect(d).toMatchObject({
			present: true,
			names: ['CONSOLE_DO_READ_TOKEN'],
			optionalBlank: ['CONSOLE_CF_WRITE_TOKEN', 'CONSOLE_DO_WRITE_TOKEN'],
		});
		expect(d.missing).toContain('CONSOLE_GITHUB_TOKEN');
		expect(JSON.stringify(d)).not.toContain('test-value-6');
		process.env['CONSOLE_KEYS_FILE'] = join(dir, 'missing.env');
		expect(new KeySourceService().describe()).toMatchObject({ present: false, names: [], readAt: null });
	});
});
