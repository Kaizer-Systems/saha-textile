import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleApi } from './console-api';
import { ConsoleContext } from './console-context';
import { ConsoleSession } from './session';

import type { Environment, Repository } from '@saha-textile/release-console-contracts';

const env = (name: string): Environment =>
	({ name, label: name, cloudId: null, domains: [], secretsId: null, secretsPath: '', branch: '' }) as Environment;
const repo = (id: string, envs: string[]): Repository => ({
	id,
	name: id,
	role: '',
	sourceCode: { vendor: 'github', repository: `own/${id}`, keyId: null },
	environments: envs.map(env),
	cloud: [],
	edge: [],
	secrets: [],
	menus: [],
});
const PROJECTS = {
	projects: [
		{
			id: 'proj_1',
			name: 'Saha Textile',
			repositories: [repo('shop', ['local', 'staging']), repo('api', ['local', 'production'])],
		},
	],
};

async function at(url: string) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideRouter([{ path: '**', children: [] }]),
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ConsoleApi, useValue: { projects: vi.fn(async () => PROJECTS) } },
		],
	});
	TestBed.inject(ConsoleSession).set('token-1');
	const ctx = TestBed.inject(ConsoleContext);
	await TestBed.inject(Router).navigateByUrl(url);
	await vi.waitFor(() => expect(ctx.projects.data()).toBeTruthy());
	return ctx;
}

afterEach(() => {
	sessionStorage.clear();
});

describe('where the owner is in the console', () => {
	it('reads a repository, its menu and its own environments', async () => {
		const ctx = await at('/p/proj_1/r/shop/deploy?tab=staging');
		expect(ctx.level()).toBe('repository');
		expect(ctx.repoId()).toBe('shop');
		expect(ctx.repo()?.id).toBe('shop');
		expect(ctx.repoMenu()?.menu.length).toBeGreaterThan(0);
		expect(ctx.environments().map((e) => e.name)).toEqual(['local', 'staging']);
	});

	it('gathers every environment name of a project once, and has no repository there', async () => {
		const ctx = await at('/p/proj_1');
		expect(ctx.level()).toBe('project');
		expect(ctx.repoId()).toBeNull();
		expect(ctx.repoMenu()).toBeNull();
		expect(ctx.environments().map((e) => e.name)).toEqual(['local', 'staging', 'production']);
	});

	it('has no project or repository in an address that stops short', async () => {
		expect((await at('/p')).projectId()).toBeNull();
		const short = await at('/p/proj_1/r');
		expect(short.level()).toBe('repository');
		expect(short.repoId()).toBeNull();
		const other = await at('/p/proj_9');
		expect(other.environments()).toEqual([]);
	});
});
