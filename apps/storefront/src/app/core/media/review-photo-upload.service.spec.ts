import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewPhotoRefusal, ReviewPhotoUploadService } from './review-photo-upload.service';

const heicTo = vi.hoisted(() => vi.fn());
vi.mock('heic-to', () => ({ heicTo }));
vi.mock('@core/config/runtime-config', () => ({
	runtimeConfig: { apiUrl: 'https://api.test' },
	runtimeConfigReady: Promise.resolve(),
}));

const jpeg = [0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const png = [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const heic = [0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
const fileOf = (bytes: number[], name = 'photo.jpg') => {
	const file = new File([new Uint8Array(bytes)], name);
	// jsdom's Blob has no arrayBuffer on a slice, so hand back the real bytes.
	file.slice = (() => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer })) as never;
	return file;
};

describe('ReviewPhotoUploadService', () => {
	const post = vi.fn();
	const get = vi.fn();
	const fetchMock = vi.fn();
	const close = vi.fn();
	const service = () => TestBed.inject(ReviewPhotoUploadService);

	beforeEach(() => {
		post.mockReset();
		get.mockReset();
		fetchMock.mockReset().mockResolvedValue({ ok: true });
		heicTo.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 800, height: 600, close })),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { post, get } }] });
		post.mockImplementation((url: string) =>
			url.endsWith('/presign')
				? of({ assetId: 'a1', uploadUrl: 'https://bucket/put', headers: { 'x-amz-acl': 'private' } })
				: of({ assetId: 'a1', state: 'ready', error: null, previewUrl: 'https://cdn/a1.webp' }),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('refuses bytes that are not a photo, whatever the name says', async () => {
		await expect(service().upload(fileOf(new Array(16).fill(1)), 'p1')).rejects.toMatchObject({
			code: 'not_an_image',
		});
		const unknownBrand = [0, 0, 0, 24, ...[...'ftypisom'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
		await expect(service().upload(fileOf(unknownBrand), 'p1')).rejects.toBeInstanceOf(ReviewPhotoRefusal);
	});

	it('uploads a JPEG straight to storage and returns the finished photo', async () => {
		const file = fileOf(jpeg);
		const result = await service().upload(file, 'p1');
		expect(result).toEqual({ assetId: 'a1', previewUrl: 'https://cdn/a1.webp', warning: null });
		expect(post.mock.calls[0]?.[1]).toMatchObject({
			contentType: 'image/jpeg',
			fileName: 'photo.jpg',
			width: 800,
			height: 600,
			productId: 'p1',
		});
		expect(fetchMock).toHaveBeenCalledWith('https://bucket/put', {
			method: 'PUT',
			headers: { 'x-amz-acl': 'private' },
			body: file,
		});
		expect(close).toHaveBeenCalled();
	});

	it('keeps PNG as PNG and warns about a small photo', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 300, height: 200, close })),
		);
		const result = await service().upload(fileOf(png, 'small.png'), 'p1');
		expect(post.mock.calls[0]?.[1]).toMatchObject({ contentType: 'image/png' });
		expect(result.warning).toBe('below_recommended_size');
	});

	it('converts HEIC to JPEG and renames it', async () => {
		const converted = new Blob(['converted']);
		heicTo.mockResolvedValue(converted);
		await service().upload(fileOf(heic, 'IMG_1.HEIC'), 'p1');
		expect(heicTo).toHaveBeenCalledOnce();
		expect(post.mock.calls[0]?.[1]).toMatchObject({ contentType: 'image/jpeg', fileName: 'IMG_1.jpg' });
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: converted });
	});

	it('refuses a photo over 25 MB', async () => {
		const file = fileOf(jpeg);
		Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 });
		await expect(service().upload(file, 'p1')).rejects.toMatchObject({ code: 'too_large' });
	});

	it('fails when storage refuses the bytes', async () => {
		fetchMock.mockResolvedValue({ ok: false });
		await expect(service().upload(fileOf(jpeg), 'p1')).rejects.toMatchObject({ code: 'processing_failed' });
	});

	it('polls while the worker runs, then fails if it reports failure', async () => {
		vi.useFakeTimers();
		post.mockImplementation((url: string) =>
			url.endsWith('/presign')
				? of({ assetId: 'a1', uploadUrl: 'https://bucket/put', headers: {} })
				: of({ assetId: 'a1', state: 'queued', error: null, previewUrl: null }),
		);
		get.mockReturnValueOnce(of({ state: 'processing' })).mockReturnValueOnce(of({ state: 'failed' }));
		const outcome = service()
			.upload(fileOf(jpeg), 'p1')
			.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(3100);
		expect(await outcome).toMatchObject({ code: 'processing_failed' });
		expect(get).toHaveBeenCalledTimes(2);
	});

	it('gives up after the polling limit', async () => {
		vi.useFakeTimers();
		post.mockImplementation((url: string) =>
			url.endsWith('/presign')
				? of({ assetId: 'a1', uploadUrl: 'https://bucket/put', headers: {} })
				: of({ state: 'processing' }),
		);
		get.mockImplementation(() => of({ state: 'processing' }));
		const outcome = service()
			.upload(fileOf(jpeg), 'p1')
			.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(1500 * 61);
		expect(await outcome).toMatchObject({ code: 'processing_failed' });
		expect(get).toHaveBeenCalledTimes(60);
	});

	it('posts the review to the storefront endpoint', async () => {
		post.mockReturnValue(of({ id: 'r1' }));
		const body = {
			productId: 'p1',
			orderId: 'o1',
			rating: 5,
			title: null,
			body: 'Good',
			imageAssetIds: [],
		};
		await expect(service().submit(body)).resolves.toEqual({ id: 'r1' });
		expect(String(post.mock.calls[0]?.[0])).toMatch(/\/storefront\/reviews$/);
	});
});
