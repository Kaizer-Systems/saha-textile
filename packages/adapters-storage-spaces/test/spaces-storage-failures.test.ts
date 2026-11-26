import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { SpacesStorageAdapter, SpacesStorageError, type SpacesStorageConfig } from '../src/index.js';

const { signer } = vi.hoisted(() => ({ signer: vi.fn() }));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: signer }));

const config: SpacesStorageConfig = {
	key: 'TEST_ACCESS_KEY_ID',
	secret: 'test-secret-key-value-not-real',
	bucket: 'saha-textile-media',
	region: 'sgp1',
	endpoint: 'https://sgp1.digitaloceanspaces.com',
};

const adapterSending = (send: () => Promise<unknown>) =>
	new SpacesStorageAdapter(config, { send: vi.fn(send) } as unknown as S3Client);

const broken = () =>
	adapterSending(async () => {
		throw new Error('socket hang up');
	});

describe('download', () => {
	it('returns the object bytes', async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const adapter = adapterSending(async () => ({ Body: { transformToByteArray: async () => bytes } }));
		expect(await adapter.download('media/a/original.jpg')).toBe(bytes);
	});

	it('refuses an empty body', async () => {
		await expect(adapterSending(async () => ({})).download('media/a/original.jpg')).rejects.toBeInstanceOf(
			SpacesStorageError,
		);
	});

	it('checks the key first', async () => {
		await expect(adapterSending(async () => ({})).download('../secrets')).rejects.toThrow(/relative path/);
	});
});

describe('transport failures are wrapped', () => {
	it('on upload', async () => {
		await expect(
			broken().upload({ key: 'media/a/b.webp', body: new Uint8Array([1]), contentType: 'image/webp' }),
		).rejects.toThrow('Failed to upload object "media/a/b.webp"');
	});

	it('on a batch delete', async () => {
		await expect(broken().deleteMany(['media/a/b.webp'])).rejects.toThrow('Failed to delete 1 objects');
	});

	it('on a visibility change', async () => {
		await expect(broken().setVisibility('media/a/b.webp', 'private')).rejects.toThrow(
			'Failed to set visibility of "media/a/b.webp"',
		);
	});

	it('on presigning a download', async () => {
		signer.mockRejectedValueOnce(new Error('clock skew'));
		await expect(broken().createSignedDownloadUrl({ key: 'media/a/b.webp', expiresInSeconds: 60 })).rejects.toThrow(
			'Failed to presign download',
		);
	});

	it('on presigning an upload', async () => {
		signer.mockRejectedValueOnce(new Error('clock skew'));
		await expect(
			broken().createSignedUploadUrl({ key: 'media/a/b.webp', contentType: 'image/webp' }),
		).rejects.toThrow('Failed to presign upload');
	});
});

describe('deleteMany', () => {
	it('reports a real failure in the batch', async () => {
		const adapter = adapterSending(async () => ({ Errors: [{ Key: 'media/a/b.webp', Code: 'AccessDenied' }] }));
		await expect(adapter.deleteMany(['media/a/b.webp'])).rejects.toBeInstanceOf(SpacesStorageError);
	});

	it('accepts a reply with no errors list', async () => {
		await expect(adapterSending(async () => ({})).deleteMany(['media/a/b.webp'])).resolves.toBeUndefined();
	});
});

describe('storage key limits', () => {
	it('refuses a key over 1024 characters', () => {
		expect(() => adapterSending(async () => ({})).getUrl('a'.repeat(1025))).toThrow(/at most 1024/);
	});

	it('refuses the delete character', () => {
		expect(() => adapterSending(async () => ({})).getUrl(`a${String.fromCodePoint(0x7f)}b`)).toThrow(/control/);
	});
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of source) items.push(item);
	return items;
}

const upload = { key: 'media/asset-1/original.zip', uploadId: 'upload-1' };
const start = { key: upload.key, contentType: 'application/zip' };

describe('multipart errors', () => {
	it('cannot start an upload if storage returns no id', async () => {
		await expect(adapterSending(async () => ({})).startMultipartUpload(start)).rejects.toMatchObject({
			message: `Failed to start a multipart upload for "${upload.key}"`,
			cause: new Error('no upload id'),
		});
	});

	it('wraps failure to sign a valid part', async () => {
		const error = new Error('clock skew');
		signer.mockRejectedValueOnce(error);
		await expect(
			broken().createSignedPartUrl({ ...upload, partNumber: 1, expiresInSeconds: 60 }),
		).rejects.toMatchObject({
			message: `Failed to presign part 1 of "${upload.key}"`,
			cause: error,
		});
	});

	it('reports both listing and abort errors with the object key', async () => {
		await expect(broken().listUploadedParts(upload)).rejects.toThrow(`Failed to list the parts of "${upload.key}"`);
		await expect(broken().abortMultipartUpload(upload)).rejects.toThrow(
			`Failed to stop the multipart upload of "${upload.key}"`,
		);
	});

	it('reports a failed completion after listing the parts', async () => {
		const refused = new Error('storage refused to join parts');
		const send = vi
			.fn()
			.mockResolvedValueOnce({ Parts: [{ PartNumber: 1, ETag: 'etag' }] })
			.mockRejectedValueOnce(refused);
		await expect(adapterSending(send).completeMultipartUpload(upload)).rejects.toMatchObject({
			message: `Failed to finish the multipart upload of "${upload.key}"`,
			cause: refused,
		});
	});

	it('still reports the missing ETag if the cleanup also fails', async () => {
		const send = vi
			.fn()
			.mockResolvedValueOnce({ UploadId: upload.uploadId })
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(new Error('abort failed'));
		await expect(adapterSending(send).uploadStream({ ...start, body: ReadableBytes.empty() })).rejects.toThrow(
			`No ETag for part 1 of "${upload.key}"`,
		);
		expect(send).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ input: expect.objectContaining({ UploadId: upload.uploadId }) }),
		);
	});

	it('cannot upload bytes if storage returns no upload id', async () => {
		await expect(
			adapterSending(async () => ({})).uploadStream({ ...start, body: ReadableBytes.empty() }),
		).rejects.toThrow(`No upload id for "${upload.key}"`);
	});
});

const ReadableBytes = { empty: async function* (): AsyncIterable<Uint8Array> {} };

describe('streaming read errors', () => {
	it.each([undefined, { transformToByteArray: () => Uint8Array.of(1) }])(
		'requires a stream in the response',
		async (Body) => {
			await expect(collect(adapterSending(async () => ({ Body })).readStream(upload.key))).rejects.toThrow(
				'no readable body',
			);
		},
	);

	it('wraps transport failure while opening the object', async () => {
		await expect(collect(broken().readStream(upload.key))).rejects.toThrow(`Failed to read object "${upload.key}"`);
	});
});
