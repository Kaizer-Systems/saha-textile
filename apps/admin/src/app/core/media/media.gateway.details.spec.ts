import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaGateway } from './media.gateway';

const setup = (asset: Record<string, unknown>) => {
	const http = { get: vi.fn(() => of({ asset: { slug: 'red-saree', ...asset } })), patch: vi.fn(() => of({})) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
	return { gateway: TestBed.inject(MediaGateway), http };
};

describe('an image’s details', () => {
	it('reads the file name and every text, with empty texts where the image has none', async () => {
		const full = setup({ text: { alt: { en: 'Red saree' }, title: { en: 'Red' }, caption: { en: 'Woven' } } });
		await expect(firstValueFrom(full.gateway.details('med 1'))).resolves.toEqual({
			slug: 'red-saree',
			text: { alt: { en: 'Red saree' }, title: { en: 'Red' }, caption: { en: 'Woven' } },
		});
		expect(String((full.http.get.mock.lastCall as unknown[] | undefined)?.[0])).toContain('/med%201');
		const bare = setup({});
		await expect(firstValueFrom(bare.gateway.details('med_2'))).resolves.toEqual({
			slug: 'red-saree',
			text: { alt: {}, title: {}, caption: {} },
		});
	});

	it('saves the details and answers nothing', async () => {
		const { gateway, http } = setup({});
		const body = { slug: 'red-saree', alt: { en: 'Red saree' }, caption: {} };
		await expect(firstValueFrom(gateway.saveDetails('med_1', body))).resolves.toBeUndefined();
		expect((http.patch.mock.lastCall as unknown[] | undefined)?.[1]).toEqual(body);
	});
});
