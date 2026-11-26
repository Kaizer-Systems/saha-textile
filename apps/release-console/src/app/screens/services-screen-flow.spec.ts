import { TestBed } from '@angular/core/testing';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { ServicesScreen } from './services-screen';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';

/** The screen's members these tests use (protected on the component). */
interface Screen {
	onThisComputer: () => boolean;
	services: { data: () => unknown };
	manifest: { data: () => unknown; isPending: () => boolean };
	readAt: () => string;
	branch: () => string;
	parts: () => Array<{ id: string; tone: string; state: string }>;
	partsNote: () => string;
	checkAgain(): void;
}

const container = (name: string, state: string, health: string, uptime: string) => ({ name, state, health, uptime });
const SERVICES = {
	readAt: '2026-11-24T04:00:00.000Z',
	services: [
		container('stack-api-1', 'running', 'healthy', '2h'),
		container('web', 'running', 'starting', '1m'),
		container('stack-db-1', 'exited', 'none', '0s'),
		container('stack-queue-1', 'running', 'unhealthy', '1h'),
		container('stack-mail-1', 'running', 'none', '3h'),
	],
};
const part = (id: string) => ({ id, kind: 'service', tech: 'node', service: id });
const MANIFEST = {
	state: 'ok',
	data: { found: true, manifest: { parts: ['api', 'web', 'db', 'queue', 'mail', 'gone'].map(part) } },
};
const REPO = {
	sourceCode: { vendor: 'github', repository: 'own/shop' },
	environments: [
		{ name: 'local', cloudId: null, branch: 'dev' },
		{ name: 'staging', cloudId: 'c1', branch: '' },
	],
};

function make(options: {
	repo?: unknown;
	manifest?: () => Promise<unknown>;
	environment?: string;
	repoId?: string | null;
}) {
	const api = {
		localServices: vi.fn(async () => SERVICES),
		repositoryFile: vi.fn(options.manifest ?? (async () => MANIFEST)),
	};
	const repo = 'repo' in options ? options.repo : REPO;
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: api },
			{
				provide: ConsoleContext,
				useValue: { repoId: () => ('repoId' in options ? options.repoId : 'shop'), repo: () => repo },
			},
		],
	});
	TestBed.overrideComponent(ServicesScreen, { set: { imports: [], template: '' } });
	TestBed.inject(ConsoleState).setEnvironment(options.environment ?? 'local');
	const fixture = TestBed.createComponent(ServicesScreen);
	fixture.detectChanges();
	return { c: fixture.componentInstance as unknown as Screen, api };
}

describe('the services screen', () => {
	it('reads the containers on this computer and joins each part of the manifest to its container', async () => {
		const { c, api } = make({});
		expect(c.onThisComputer()).toBe(true);
		expect(c.readAt()).toBe('—');
		await vi.waitFor(() => expect(c.services.data()).toBeTruthy());
		await vi.waitFor(() => expect(c.manifest.data()).toBeTruthy());
		expect(api.repositoryFile).toHaveBeenCalledWith({ vendor: 'github', repository: 'own/shop', ref: 'dev' });
		expect(c.readAt()).not.toBe('—');
		expect(c.parts().map((p) => [p.id, p.tone, p.state])).toEqual([
			['api', 'ok', 'running · healthy · 2h'],
			['web', 'amber', 'running · starting · 1m'],
			['db', 'red', 'exited · 0s'],
			['queue', 'red', 'running · unhealthy · 1h'],
			['mail', 'ok', 'running · 3h'],
			['gone', 'red', 'no container'],
		]);
		expect(c.partsNote()).toContain('lists no parts yet');
		c.checkAgain();
		await vi.waitFor(() => expect(api.localServices.mock.calls.length).toBeGreaterThan(1));
	});

	it('leaves Docker alone for an environment in the cloud, an unknown one, or no repository', async () => {
		const cloud = make({ environment: 'staging' });
		expect(cloud.c.onThisComputer()).toBe(false);
		expect(cloud.c.branch()).toBe('');
		await vi.waitFor(() =>
			expect(cloud.api.repositoryFile).toHaveBeenCalledWith({ vendor: 'github', repository: 'own/shop' }),
		);
		expect(make({ environment: 'nowhere' }).c.onThisComputer()).toBe(false);
		const noRepoId = make({ repoId: null });
		expect(noRepoId.c.onThisComputer()).toBe(true);
		expect(noRepoId.api.localServices).not.toHaveBeenCalled();
		const none = make({ repo: null });
		expect(none.c.onThisComputer()).toBe(false);
		expect(none.c.branch()).toBe('');
		expect(none.c.partsNote()).toBe('Reading .release-console.json…');
		const elsewhere = make({ repo: { ...REPO, sourceCode: { vendor: 'gitlab', repository: 'own/shop' } } });
		expect(elsewhere.api.repositoryFile).not.toHaveBeenCalled();
	});

	it('says when the branch has no manifest, why it could not be read, and when nothing answered', async () => {
		const missing = make({ manifest: async () => ({ state: 'ok', data: { found: false, manifest: null } }) });
		await vi.waitFor(() => expect(missing.c.manifest.data()).toBeTruthy());
		expect(missing.c.parts()).toEqual([]);
		expect(missing.c.partsNote()).toContain('No .release-console.json on this branch');
		const refused = make({ manifest: async () => ({ state: 'error', message: 'Bad JSON' }) });
		await vi.waitFor(() => expect(refused.c.partsNote()).toBe('Bad JSON'));
		expect(refused.c.parts()).toEqual([]);
		const wordless = make({ manifest: async () => ({ state: 'unknown' }) });
		await vi.waitFor(() => expect(wordless.c.manifest.data()).toBeTruthy());
		expect(wordless.c.partsNote()).toBe('The manifest could not be read.');
		const failed = make({ manifest: async () => Promise.reject(new Error('down')) });
		await vi.waitFor(() => expect(failed.c.manifest.isPending()).toBe(false));
		expect(failed.c.partsNote()).toBe('The manifest could not be read.');
	});
});
