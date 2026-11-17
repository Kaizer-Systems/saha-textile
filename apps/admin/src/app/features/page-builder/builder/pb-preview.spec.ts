import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PREVIEW_SIZES, PbPreview } from './pb-preview';

const render = (previewCode: () => unknown) => {
	TestBed.resetTestingModule();
	const urls: string[] = [];
	TestBed.configureTestingModule({
		providers: [
			{ provide: PageBuilderGateway, useValue: { previewCode: vi.fn(previewCode) } },
			{
				provide: DomSanitizer,
				useValue: { bypassSecurityTrustResourceUrl: (url: string) => (urls.push(url), url) },
			},
		],
	});
	TestBed.overrideComponent(PbPreview, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(PbPreview);
	fixture.componentRef.setInput('layoutId', 'lay_1');
	fixture.componentRef.setInput('pageType', 'home');
	fixture.componentRef.setInput('locale', 'bn');
	return { preview: fixture.componentInstance, urls };
};

describe('the preview frame (Page Builder step 6, C1–C6)', () => {
	it('opens the shop’s preview address in the language shown with a fresh one-time code, never a pass', async () => {
		const { preview, urls } = render(() => of({ code: 'c'.repeat(43), expiresAt: '2026-11-17T10:01:00.000Z' }));
		await preview.load();
		expect(urls.at(-1)).toMatch(/\/bn\/__preview\/home\?code=c{43}$/);
		expect(preview.failed()).toBe(false);
	});

	it('scales a large screen down to the pane, never up, and offers the six sizes', () => {
		const { preview } = render(() => of({ code: 'c'.repeat(43), expiresAt: '' }));
		expect(PREVIEW_SIZES.map((size) => size.key)).toEqual([
			'phone',
			'phone_side',
			'tablet',
			'tablet_side',
			'desktop',
			'large',
		]);
		preview.paneWidth.set(720);
		preview.size.set(PREVIEW_SIZES[5]);
		expect(preview.scale()).toBeCloseTo(720 / 2560);
		preview.size.set(PREVIEW_SIZES[0]);
		expect(preview.scale()).toBe(1);
	});

	it('says when the preview cannot open', async () => {
		const { preview } = render(() => throwError(() => new Error('down')));
		await preview.load();
		expect(preview.failed()).toBe(true);
	});
});
