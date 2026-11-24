import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PbPreview } from './pb-preview';

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

describe('the preview frame: the last cases', () => {
	it('hears the window’s messages in the browser', () => {
		const { preview } = render(() => of({ code: 'c'.repeat(43), expiresAt: '' }));
		const heard = vi.spyOn(preview, 'heard').mockImplementation(() => undefined);
		window.dispatchEvent(new MessageEvent('message', { data: { source: 'st-preview', type: 'ready' } }));
		expect(heard).toHaveBeenCalledTimes(1);
	});
});
