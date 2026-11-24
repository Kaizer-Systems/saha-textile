import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { ROTATE_ROWS } from '@saha-textile/release-console-contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { RotateScreen } from './rotate-screen';
import { SeoScreen } from './seo-screen';
import { SshList } from './ssh-list';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';

const REPO = {
	environments: [
		{ name: 'local', label: 'Local', cloudId: null },
		{ name: 'staging', label: 'Staging', cloudId: 'c1' },
	],
};

function make<T>(component: Type<T>, api: Record<string, unknown>, options: { env?: string; repo?: unknown } = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{
				provide: ConsoleContext,
				useValue: {
					projectId: () => 'proj_1',
					repoId: () => 'shop',
					repo: () => ('repo' in options ? options.repo : REPO),
					project: () => ({ sshEmails: ['a@b.test'] }),
				},
			},
		],
	});
	TestBed.overrideComponent(component, { set: { imports: [], template: '' } });
	TestBed.inject(ConsoleState).setEnvironment(options.env ?? 'local');
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return fixture.componentInstance as unknown;
}

describe('the SSH sign-in list', () => {
	interface List {
		draft: () => string[];
		message: () => string;
		open(): void;
		add(input: HTMLInputElement): void;
		save(): Promise<void>;
	}
	const box = (value: string) => Object.assign(document.createElement('input'), { value });

	it('adds a real address once, keeps a wrong one in the box, and says where Access changed', async () => {
		const setSshEmails = vi.fn(async () => ({ hosts: ['ssh.example.test'] }));
		const c = make(SshList, { setSshEmails }) as List;
		c.open();
		const wrong = box('not-an-address');
		c.add(wrong);
		expect(wrong.value).toBe('not-an-address');
		const right = box(' New@B.test ');
		c.add(right);
		expect(right.value).toBe('');
		c.add(box('new@b.test'));
		expect(c.draft()).toEqual(['a@b.test', 'new@b.test']);
		await c.save();
		expect(c.message()).toBe('Saved; Access updated on ssh.example.test.');
		setSshEmails.mockResolvedValueOnce({ hosts: [] });
		await c.save();
		expect(c.message()).toBe('Saved; no server has SSH yet.');
		setSshEmails.mockRejectedValueOnce('down');
		await c.save();
		expect(c.message()).toBe('The console API did not answer.');
	});
});

describe('the SEO screen', () => {
	interface Seo {
		onThisComputer: () => boolean;
		latest: { data: () => unknown };
		running: () => boolean;
		sitemapLabel: () => string;
	}
	const result = {
		origin: 'https://example.test',
		sitemap: '/sitemap.xml',
		at: '2026-11-24T04:00:00.000Z',
		listed: 1,
		checked: 1,
		ok: 1,
		redirects: 0,
		notFound: 0,
		other: 0,
		failures: [],
		paths: ['/'],
		note: '',
	};

	it('follows the newest sitemap check, names its sitemap, and reads again while it runs', async () => {
		const job = vi.fn(async (id: string) => ({
			id,
			status: id === 'seo-new' ? 'running' : 'passed',
			lines: [{ seq: 1, stream: 'out', text: '', event: { result } }],
		}));
		const jobs = vi.fn(async () => [
			{ id: 'seo-old', kind: 'seo', startedAt: '2026-11-23T00:00:00.000Z' },
			{ id: 'seo-new', kind: 'seo', startedAt: '2026-11-24T00:00:00.000Z' },
			{ id: 'seo-mid', kind: 'seo', startedAt: '2026-11-23T12:00:00.000Z' },
			{ id: 'deploy', kind: 'deploy', startedAt: '2026-11-25T00:00:00.000Z' },
		]);
		const c = make(SeoScreen, { notFound: vi.fn(async () => []), jobs, job }) as Seo;
		expect(c.sitemapLabel()).toBe('every page it lists, one at a time');
		await vi.waitFor(() => expect(c.running()).toBe(true));
		expect(job).toHaveBeenCalledWith('seo-new');
		expect(c.sitemapLabel()).toBe('https://example.test/sitemap.xml');
		await vi.waitFor(() => expect(job.mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });
	});

	it('has nothing to follow without a check, and knows a server environment from this computer', async () => {
		const api = { notFound: vi.fn(async () => []), jobs: vi.fn(async () => []), job: vi.fn() };
		const c = make(SeoScreen, api) as Seo;
		await vi.waitFor(() => expect(c.latest.data()).toBeNull());
		expect(c.onThisComputer()).toBe(true);
		expect((make(SeoScreen, api, { env: 'staging' }) as Seo).onThisComputer()).toBe(false);
		expect((make(SeoScreen, api, { env: 'nowhere' }) as Seo).onThisComputer()).toBe(true);
	});
});

describe('the key rotation screen', () => {
	interface Rotate {
		ids: () => string[];
		message: () => string;
		labels(ids: string[]): string;
		toggle(key: string): void;
		make(): Promise<void>;
	}

	it('picks and unpicks keys, names them, and says what the deploy still has to carry', async () => {
		const rotate = vi.fn(async () => ({ state: { pending: ['mongo-app'], lastChanged: ['mongo-app'] } }));
		const c = make(RotateScreen, { rotation: vi.fn(async () => ({})), rotate }) as Rotate;
		const [first, second] = ROTATE_ROWS;
		c.toggle(first?.key as string);
		c.toggle(second?.key as string);
		c.toggle(second?.key as string);
		expect(c.ids()).toEqual([...(first?.ids ?? [])]);
		expect(c.labels([...(first?.ids ?? [])])).toBe(first?.label);
		await c.make();
		expect(c.message()).toContain('then use Live deploy');
		rotate.mockResolvedValueOnce({ state: { pending: [], lastChanged: ['mongo-app'] } });
		await c.make();
		expect(c.message()).toContain('the next deploy carries them');
	});
});
