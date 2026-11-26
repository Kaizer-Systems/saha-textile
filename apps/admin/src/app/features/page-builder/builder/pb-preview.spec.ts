import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
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

describe('choosing between the builder and its frame (C41)', () => {
	const site = new URL(runtimeConfig.siteUrl).origin;
	const withFrame = () => {
		const { preview } = render(() => of({ code: 'c'.repeat(43), expiresAt: '' }));
		const contentWindow = { postMessage: vi.fn() };
		Object.defineProperty(preview, 'frame', { value: () => ({ nativeElement: { contentWindow } }) });
		const chosen: string[] = [];
		preview.choose.subscribe((id) => chosen.push(id));
		return { preview, contentWindow, chosen };
	};
	const message = (data: unknown, origin: string, source: unknown) =>
		({ data, origin, source }) as unknown as MessageEvent;

	it('chooses the section clicked in its own frame, from the shop’s origin only', () => {
		const { preview, contentWindow, chosen } = withFrame();
		const select = { source: 'st-preview', type: 'select', sectionId: 'newsletter' };
		preview.heard(message(select, site, contentWindow));
		preview.heard(message(select, 'https://evil.test', contentWindow));
		preview.heard(message(select, site, {}));
		preview.heard(message({ ...select, sectionId: '<b>' }, site, contentWindow));
		expect(chosen).toEqual(['newsletter']);
	});

	it('outlines the chosen section once the frame is ready, sent to the shop’s origin', () => {
		const { preview, contentWindow } = withFrame();
		preview.heard(message({ source: 'st-preview', type: 'ready' }, site, contentWindow));
		expect(contentWindow.postMessage).toHaveBeenLastCalledWith(
			{ source: 'pb-admin', type: 'outline', sectionId: null },
			site,
		);
	});
});
