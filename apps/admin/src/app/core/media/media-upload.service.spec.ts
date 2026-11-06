import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaUploadService } from './media-upload.service';
import { MediaGateway } from './media.gateway';

const ready = { assetId: 'a1', state: 'ready', error: null, warnings: ['small'], previewUrl: 'p' };

describe('MediaUploadService', () => {
	const gateway = { presign: vi.fn(), finalize: vi.fn(), status: vi.fn() };
	const fetchMock = vi.fn();
	const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
	const service = () => TestBed.inject(MediaUploadService);

	beforeEach(() => {
		gateway.presign
			.mockReset()
			.mockReturnValue(
				of({ assetId: 'a1', uploadUrl: 'https://bucket/put', headers: {}, warnings: ['small', 'dark'] }),
			);
		gateway.finalize.mockReset().mockReturnValue(of(ready));
		gateway.status.mockReset();
		fetchMock.mockReset().mockResolvedValue({ ok: true });
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
		);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: MediaGateway, useValue: gateway }] });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('uploads, finalises and merges the warnings', async () => {
		const result = await service().upload(file, 'product');
		expect(gateway.presign.mock.lastCall?.[0]).toMatchObject({ purpose: 'product', width: 800, height: 600 });
		expect(fetchMock).toHaveBeenCalledWith('https://bucket/put', { method: 'PUT', headers: {}, body: file });
		expect(result.warnings).toEqual(['small', 'dark']);
	});

	it('reports a refused upload', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 403 });
		await expect(service().upload(file, 'product')).rejects.toThrow('HTTP 403');
	});

	it('polls while the worker runs', async () => {
		vi.useFakeTimers();
		gateway.finalize.mockReturnValue(of({ ...ready, state: 'queued' }));
		gateway.status.mockReturnValueOnce(of({ ...ready, state: 'processing' })).mockReturnValueOnce(of(ready));
		const outcome = service().upload(file, 'product');
		await vi.advanceTimersByTimeAsync(3100);
		await expect(outcome).resolves.toMatchObject({ state: 'ready' });
		expect(gateway.status).toHaveBeenCalledTimes(2);
	});

	it('stops at the polling limit', async () => {
		vi.useFakeTimers();
		gateway.finalize.mockReturnValue(of({ ...ready, state: 'processing' }));
		gateway.status.mockReturnValue(of({ ...ready, state: 'processing' }));
		const outcome = service().upload(file, 'product');
		await vi.advanceTimersByTimeAsync(1500 * 81);
		await expect(outcome).resolves.toMatchObject({ state: 'processing' });
		expect(gateway.status).toHaveBeenCalledTimes(80);
	});
});
