import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { SpacesStorageAdapter, SpacesStorageError, type SpacesStorageConfig } from '../src/index.js';

const baseConfig: SpacesStorageConfig = {
	key: 'TEST_ACCESS_KEY_ID',
	secret: 'test-secret-key-value-not-real',
	bucket: 'saha-textile-media',
	region: 'sgp1',
	endpoint: 'https://sgp1.digitaloceanspaces.com',
	cdnUrl: 'https://saha-textile-media.sgp1.cdn.digitaloceanspaces.com',
};

/** A stand-in for `S3Client` that records commands instead of performing network calls. */
function fakeClient(send: (command: unknown) => Promise<unknown>): S3Client {
	return { send: vi.fn(send) } as unknown as S3Client;
}

describe('getUrl', () => {
	it('composes against the CDN host when one is configured', () => {
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async () => ({})),
		);
		expect(adapter.getUrl('products/abc/card.webp')).toBe(
			'https://saha-textile-media.sgp1.cdn.digitaloceanspaces.com/products/abc/card.webp',
		);
	});

	it('falls back to the bucket origin when no CDN is configured', () => {
		const adapter = new SpacesStorageAdapter(
			{ ...baseConfig, cdnUrl: undefined },
			fakeClient(async () => ({})),
		);
		expect(adapter.getUrl('products/abc/card.webp')).toBe(
			'https://saha-textile-media.sgp1.digitaloceanspaces.com/products/abc/card.webp',
		);
	});

	it('does not double the separator when the CDN URL carries a trailing slash', () => {
		const adapter = new SpacesStorageAdapter(
			{ ...baseConfig, cdnUrl: 'https://cdn.example.com/' },
			fakeClient(async () => ({})),
		);
		expect(adapter.getUrl('a/b.webp')).toBe('https://cdn.example.com/a/b.webp');
	});

	it('percent-encodes each segment but preserves the path separators', () => {
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async () => ({})),
		);
		const url = adapter.getUrl('products/red & blue/saree #1.webp');
		expect(url).toContain('/products/red%20%26%20blue/saree%20%231.webp');
		expect(url).not.toContain('%2F');
	});
});

describe('storage key validation', () => {
	const adapter = new SpacesStorageAdapter(
		baseConfig,
		fakeClient(async () => ({})),
	);

	it.each([
		['empty', ''],
		['leading slash', '/products/a.webp'],
		['trailing slash', 'products/'],
		['empty segment', 'products//a.webp'],
		['parent traversal', 'products/../../secrets.env'],
		['single dot segment', 'products/./a.webp'],
	])('rejects a key with %s', (_label, key) => {
		expect(() => adapter.getUrl(key)).toThrow();
	});

	it('rejects a key containing a control character', () => {
		expect(() => adapter.getUrl(`products/${String.fromCodePoint(0x07)}a.webp`)).toThrow(/control characters/);
	});

	it('accepts an ordinary nested key', () => {
		expect(() => adapter.getUrl('media/2026/08/asset-1/original.jpg')).not.toThrow();
	});
});

describe('createSignedUploadUrl', () => {
	it('signs a PUT and states the headers the browser must replay', async () => {
		const adapter = new SpacesStorageAdapter(baseConfig);
		const signed = await adapter.createSignedUploadUrl({
			key: 'media/asset-1/original.jpg',
			contentType: 'image/jpeg',
		});

		expect(signed.url).toContain('saha-textile-media');
		expect(signed.url).toContain('media/asset-1/original.jpg');
		expect(signed.url).toContain('X-Amz-Signature=');
		expect(signed.url).toContain('X-Amz-Expires=900');
		expect(signed.headers).toEqual({
			'Content-Type': 'image/jpeg',
			'x-amz-acl': 'private',
		});
		// A presigned PUT carries its signature in the URL, never in POST-policy form fields.
		expect(signed.fields).toBeUndefined();
	});

	it('signs against the ORIGIN host, not the CDN', async () => {
		const adapter = new SpacesStorageAdapter(baseConfig);
		const signed = await adapter.createSignedUploadUrl({
			key: 'media/asset-1/original.jpg',
			contentType: 'image/jpeg',
		});
		// Uploads must reach the bucket; the CDN is a read-through cache and cannot accept a PUT.
		expect(signed.url).toContain('sgp1.digitaloceanspaces.com');
		expect(signed.url).not.toContain('cdn.digitaloceanspaces.com');
	});

	it('honours an explicit expiry', async () => {
		const adapter = new SpacesStorageAdapter(baseConfig);
		const signed = await adapter.createSignedUploadUrl({
			key: 'media/asset-1/original.jpg',
			contentType: 'image/jpeg',
			expiresInSeconds: 60,
		});
		expect(signed.url).toContain('X-Amz-Expires=60');
	});

	it.each([
		['zero', 0],
		['negative', -1],
		['fractional', 1.5],
		['beyond seven days', 604_801],
	])('rejects a %s expiry', async (_label, expiresInSeconds) => {
		const adapter = new SpacesStorageAdapter(baseConfig);
		await expect(
			adapter.createSignedUploadUrl({
				key: 'media/asset-1/original.jpg',
				contentType: 'image/jpeg',
				expiresInSeconds,
			}),
		).rejects.toBeInstanceOf(SpacesStorageError);
	});
});

describe('upload and delete', () => {
	it('returns the public URL of the object it wrote', async () => {
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async () => ({})),
		);
		const stored = await adapter.upload({
			key: 'media/asset-1/card.webp',
			body: new Uint8Array([1, 2, 3]),
			contentType: 'image/webp',
		});
		expect(stored).toEqual({
			key: 'media/asset-1/card.webp',
			url: 'https://saha-textile-media.sgp1.cdn.digitaloceanspaces.com/media/asset-1/card.webp',
		});
	});

	it('wraps a transport failure rather than leaking the SDK error', async () => {
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async () => {
				throw new Error('socket hang up');
			}),
		);
		await expect(adapter.delete('media/asset-1/card.webp')).rejects.toBeInstanceOf(SpacesStorageError);
	});

	it('validates the key before issuing a delete', async () => {
		const send = vi.fn(async () => ({}));
		const adapter = new SpacesStorageAdapter(baseConfig, fakeClient(send));
		await expect(adapter.delete('../other-bucket-object')).rejects.toThrow();
		expect(send).not.toHaveBeenCalled();
	});
});

describe('visibility and server-side operations', () => {
	it('writes derivatives public with the cache header it is given', async () => {
		const sent: unknown[] = [];
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async (command) => {
				sent.push(command);
				return {};
			}),
		);
		await adapter.upload({
			key: 'media/a/x-card-400w-12345678.webp',
			body: new Uint8Array([1]),
			contentType: 'image/webp',
			cacheControl: 'public, max-age=31536000, immutable',
		});
		await adapter.upload({
			key: 'media/a/y.webp',
			body: new Uint8Array([1]),
			contentType: 'image/webp',
			visibility: 'private',
		});
		const inputs = sent.map((command) => (command as { input: Record<string, unknown> }).input);
		expect(inputs[0]).toMatchObject({ ACL: 'public-read', CacheControl: 'public, max-age=31536000, immutable' });
		expect(inputs[1]).toMatchObject({ ACL: 'private' });
		expect(inputs[1]).not.toHaveProperty('CacheControl');
	});

	it('presigns a public upload only when asked', async () => {
		const adapter = new SpacesStorageAdapter(baseConfig);
		const signed = await adapter.createSignedUploadUrl({
			key: 'media/a/b.jpg',
			contentType: 'image/jpeg',
			visibility: 'public',
		});
		expect(signed.headers?.['x-amz-acl']).toBe('public-read');
	});

	it('flips an ACL for moderation', async () => {
		const sent: unknown[] = [];
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async (command) => {
				sent.push(command);
				return {};
			}),
		);
		await adapter.setVisibility('media/a/b.webp', 'public');
		expect((sent[0] as { input: Record<string, unknown> }).input).toMatchObject({
			Key: 'media/a/b.webp',
			ACL: 'public-read',
		});
	});

	it('batches deletes and tolerates keys that are already gone', async () => {
		const batches: number[] = [];
		const adapter = new SpacesStorageAdapter(
			baseConfig,
			fakeClient(async (command) => {
				const input = (command as { input: { Delete: { Objects: unknown[] } } }).input;
				batches.push(input.Delete.Objects.length);
				return { Errors: [{ Key: 'gone', Code: 'NoSuchKey' }] };
			}),
		);
		await adapter.deleteMany(Array.from({ length: 1500 }, (_, index) => `media/a/${index}.webp`));
		expect(batches).toEqual([1000, 500]);
	});

	it('signs private reads against the origin', async () => {
		const adapter = new SpacesStorageAdapter(baseConfig);
		const url = await adapter.createSignedDownloadUrl({ key: 'media/a/review.webp', expiresInSeconds: 600 });
		expect(url).toContain('sgp1.digitaloceanspaces.com');
		expect(url).toContain('X-Amz-Expires=600');
	});
});
