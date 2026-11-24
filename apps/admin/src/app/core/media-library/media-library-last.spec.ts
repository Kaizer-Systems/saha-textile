import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { heicToJpeg } from './heic';
import { HttpMediaLibraryGateway } from './http-media-library.gateway';
import { MediaLibraryGateway } from './media-library.gateway';

vi.mock('heic-to', () => ({
	heicTo: vi.fn(async ({ quality }: { quality: number }) => new Blob([`jpeg at ${quality}`], { type: 'image/jpeg' })),
}));

describe('media library: the last cases', () => {
	it('converts with the browser converter when none is handed over, and names a file without a HEIC ending', async () => {
		const picked = new File(['not really heic'], 'IMG_0042', { type: 'image/heic', lastModified: 5 });
		const jpeg = await heicToJpeg(picked);
		expect(jpeg.name).toBe('IMG_0042.jpg');
		expect(jpeg.type).toBe('image/jpeg');
		expect(jpeg.lastModified).toBe(5);
		expect(await jpeg.text()).toMatch(/^jpeg at /);
	});

	it('saves a web file name and answers nothing', async () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: MediaLibraryGateway, useClass: HttpMediaLibraryGateway },
			],
		});
		const gateway = TestBed.inject(MediaLibraryGateway);
		const http = TestBed.inject(HttpTestingController);
		const saved = firstValueFrom(gateway.saveWebName('med 1', 'red-silk'));
		const request = http.expectOne((req) => req.url.endsWith('/admin/media/med%201'));
		expect(request.request.method).toBe('PATCH');
		expect(request.request.body).toEqual({ slug: 'red-silk' });
		request.flush({ ok: true });
		expect(await saved).toBeUndefined();
		http.verify();
	});
});
