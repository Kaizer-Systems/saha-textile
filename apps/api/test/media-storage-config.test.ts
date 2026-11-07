import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/app-config';

const baseEnv = {
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const withSpaces = (overrides: Record<string, string | undefined>) =>
	loadConfig({
		...baseEnv,
		SPACES_KEY: 'DO_TEST_KEY',
		SPACES_SECRET: 'test-secret',
		SPACES_BUCKET: 'saha-textile-media',
		...overrides,
	} as NodeJS.ProcessEnv);

describe('spaces configuration', () => {
	it('is unconfigured — but still boots — when no Spaces variables are set', () => {
		const config = loadConfig(baseEnv as NodeJS.ProcessEnv);
		expect(config.spaces.configured).toBe(false);
	});

	it('is configured when the full credential trio is present', () => {
		expect(withSpaces({}).spaces.configured).toBe(true);
	});

	it.each([['SPACES_KEY'], ['SPACES_SECRET'], ['SPACES_BUCKET']])(
		'refuses to boot when %s alone is missing',
		(missing) => {
			expect(() => withSpaces({ [missing]: undefined })).toThrow();
		},
	);

	it('names the missing variable in the boot failure', () => {
		// The whole point of failing at boot is that the operator learns WHICH variable is
		// absent; a bare "invalid config" would send them to the object store's 403 instead.
		expect(() => withSpaces({ SPACES_SECRET: undefined })).toThrow(/SPACES_SECRET/);
	});

	it('defaults the region to sgp1 — BLR1 exists but Spaces creation is disabled there', () => {
		expect(withSpaces({}).spaces.region).toBe('sgp1');
	});

	it('derives the regional endpoint from the region, without the bucket in it', () => {
		const { spaces } = withSpaces({});
		expect(spaces.endpoint).toBe('https://sgp1.digitaloceanspaces.com');
		expect(spaces.endpoint).not.toContain(spaces.bucket!);
	});

	it('honours an explicit endpoint override', () => {
		expect(withSpaces({ SPACES_ENDPOINT: 'https://fra1.digitaloceanspaces.com' }).spaces.endpoint).toBe(
			'https://fra1.digitaloceanspaces.com',
		);
	});

	it('rejects a non-absolute CDN URL', () => {
		expect(() => withSpaces({ SPACES_CDN_URL: 'saha-textile-media.sgp1.cdn' })).toThrow();
	});

	it('leaves the CDN URL unset when absent, so reads fall back to the bucket origin', () => {
		expect(withSpaces({}).spaces.cdnUrl).toBeUndefined();
	});
});

describe('redis configuration', () => {
	it('defaults to a local broker', () => {
		const { redis } = loadConfig(baseEnv as NodeJS.ProcessEnv);
		expect(redis).toEqual({ host: '127.0.0.1', port: 6379, password: undefined, db: 0 });
	});

	it('coerces port and db from their string environment values', () => {
		const { redis } = loadConfig({ ...baseEnv, REDIS_PORT: '6380', REDIS_DB: '3' } as NodeJS.ProcessEnv);
		expect(redis.port).toBe(6380);
		expect(redis.db).toBe(3);
	});
});
