import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { buildAdapter, createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/app-config';
import { ConfigModule } from '../src/config/config.module';
import { MeilisearchSearch } from '../src/search/meilisearch-search';
import { PersistenceModule } from '../src/infra/persistence.module';
import { UnconfiguredStorageAdapter } from '../src/infra/unconfigured-storage.adapter';
import {
	SEARCH_PORT,
	STORAGE_PORT,
	NOTIFICATION_PORT,
	MEDIA_JOB_QUEUE,
	CDN_PURGE,
	YOUTUBE_PORT,
} from '../src/infra/tokens';

const { app, registered, hooks, connect, disconnect } = vi.hoisted(() => {
	const registered: Array<[unknown, Record<string, (...args: never[]) => unknown>]> = [];
	const hooks: Array<(...args: unknown[]) => void> = [];
	const app = {
		getHttpAdapter: () => ({
			getInstance: () => ({ addHook: (_name: string, hook: (...args: unknown[]) => void) => hooks.push(hook) }),
		}),
		register: async (plugin: unknown, options: Record<string, (...args: never[]) => unknown>) => {
			registered.push([plugin, options]);
		},
		enableCors: () => {},
		useGlobalFilters: () => {},
		enableShutdownHooks: () => {},
	};
	return { app, registered, hooks, connect: { fn: async () => {} }, disconnect: { fn: async () => {} } };
});

vi.mock('@nestjs/core', async (original) => ({
	...(await original<typeof import('@nestjs/core')>()),
	NestFactory: { create: async () => app },
}));
vi.mock('@nestjs/swagger', async (original) => {
	const real = await original<typeof import('@nestjs/swagger')>();
	return { ...real, SwaggerModule: { ...real.SwaggerModule, createDocument: () => ({}), setup: () => {} } };
});
vi.mock('@saha-textile/adapters-db-mongo', async (original) => ({
	...(await original<typeof import('@saha-textile/adapters-db-mongo')>()),
	connectMongo: () => connect.fn(),
	disconnectMongo: () => disconnect.fn(),
}));

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

const factoryFor = (token: unknown) => {
	const providers = Reflect.getMetadata('providers', PersistenceModule) as Array<{
		provide: unknown;
		useFactory: (...args: never[]) => unknown;
	}>;
	const provider = providers.find((entry) => entry.provide === token);
	return provider?.useFactory as (...args: unknown[]) => unknown;
};

describe('module composition', () => {
	it('builds the root module for a config', () => {
		const root = AppModule.forRoot(config);
		expect(root.module).toBe(AppModule);
		expect(root.imports?.length).toBeGreaterThan(5);
		expect(ConfigModule.forRoot(config).module).toBe(ConfigModule);
	});
});

describe('persistence providers', () => {
	it('loads search hits from Mongo, skipping what is gone', async () => {
		const products = { findById: vi.fn(async (id: string) => (id === 'p1' ? { id } : null)) };
		const search = factoryFor(SEARCH_PORT)(products, config) as MeilisearchSearch;
		expect(search).toBeInstanceOf(MeilisearchSearch);
		const load = (search as unknown as { loadProducts: (ids: string[]) => Promise<unknown[]> }).loadProducts;
		expect(await load(['p1', 'gone'])).toEqual([{ id: 'p1' }]);
	});

	it('uses real storage only with full credentials', () => {
		const storage = factoryFor(STORAGE_PORT);
		const spaces = {
			key: 'k',
			secret: 's',
			bucket: 'b',
			region: 'r',
			endpoint: 'https://e.test',
			cdnUrl: undefined,
		};
		expect(storage({ spaces: { ...spaces, key: '' } })).toBeInstanceOf(UnconfiguredStorageAdapter);
		expect(storage({ spaces: { ...spaces, secret: '' } })).toBeInstanceOf(UnconfiguredStorageAdapter);
		expect(storage({ spaces: { ...spaces, bucket: '' } })).toBeInstanceOf(UnconfiguredStorageAdapter);
		expect(storage({ spaces })).not.toBeInstanceOf(UnconfiguredStorageAdapter);
	});

	it('builds the rest from config', () => {
		expect(factoryFor(NOTIFICATION_PORT)(config, {}, {}, {}, {})).toBeDefined();
		expect(factoryFor(MEDIA_JOB_QUEUE)(config)).toBeDefined();
		const purge = factoryFor(CDN_PURGE);
		expect(purge({ media: {} })).toBeDefined();
		expect(purge({ media: { cloudflareZoneId: 'z' } })).toBeDefined();
		expect(purge({ media: { cloudflareZoneId: 'z', cloudflarePurgeToken: 't' } })).toBeDefined();
		const youtube = factoryFor(YOUTUBE_PORT);
		expect(youtube({ media: {} })).toBeDefined();
		expect(youtube({ media: { youtubeApiKey: 'y' } })).toBeDefined();
	});

	it('connects on boot, survives a failure, and skips for a docs build', async () => {
		const module = new PersistenceModule();
		const before = process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
		delete process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
		connect.fn = vi.fn(async () => {});
		disconnect.fn = vi.fn(async () => {});
		await module.onApplicationBootstrap();
		expect(connect.fn).toHaveBeenCalledTimes(1);
		connect.fn = vi.fn(async () => {
			throw new Error('no mongo');
		});
		await expect(module.onApplicationBootstrap()).resolves.toBeUndefined();
		await module.onApplicationShutdown();
		expect(disconnect.fn).toHaveBeenCalledTimes(1);
		process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = '1';
		await module.onApplicationBootstrap();
		await module.onApplicationShutdown();
		expect(disconnect.fn).toHaveBeenCalledTimes(1);
		if (before === undefined) delete process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
		else process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = before;
	});
});

describe('createApp', () => {
	beforeEach(() => {
		registered.length = 0;
		hooks.length = 0;
	});

	it('wires the limiter so public reads pass and a limit answers 429', async () => {
		await createApp(config);
		const limiter = registered.find(([, options]) => options?.['allowList'])?.[1] as Record<
			string,
			(input?: unknown) => unknown
		>;
		expect(limiter['allowList']?.({ method: 'GET', url: '/catalog/home' })).toBe(true);
		expect(limiter['allowList']?.({ method: 'POST', url: '/auth/storefront/login/password' })).toBe(false);
		expect(limiter['keyGenerator']?.({ headers: {}, ip: '1.2.3.4' })).toBe('1.2.3.4');
		expect(limiter['errorResponseBuilder']?.()).toBeInstanceOf(HttpException);
	});

	it('echoes the request id on every reply', async () => {
		await createApp(config);
		const reply = { header: vi.fn() };
		const done = vi.fn();
		hooks[0]?.({ id: 'r1' }, reply, 'body', done);
		expect(reply.header).toHaveBeenCalledWith(expect.any(String), 'r1');
		expect(done).toHaveBeenCalledTimes(1);
	});
});

describe('buildAdapter', () => {
	it('builds with and without TLS, and logs quietly in tests', () => {
		expect(buildAdapter(config)).toBeDefined();
		expect(() => buildAdapter({ ...config, tls: { certFile: '/nope', keyFile: '/nope' } } as never)).toThrow();
		expect(buildAdapter({ ...config, nodeEnv: 'test' } as never)).toBeDefined();
		expect(buildAdapter({ ...config, tls: { certFile: 'only-cert' } } as never)).toBeDefined();
	});
});
