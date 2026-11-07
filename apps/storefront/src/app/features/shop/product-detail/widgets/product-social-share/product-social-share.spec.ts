import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductSocialShare } from './product-social-share';

const render = (platform = 'browser') => {
	const open = vi.fn();
	const location = { href: '' };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	TestBed.overrideComponent(ProductSocialShare, {
		set: { imports: [], template: '', providers: [{ provide: DOCUMENT, useValue: { location } }] },
	});
	const share = TestBed.createComponent(ProductSocialShare).componentInstance;
	share.url = 'https://shop.test';
	vi.stubGlobal('open', open);
	return { share, open, location };
};
const encoded = encodeURIComponent('https://shop.test/product/red');

afterEach(() => vi.unstubAllGlobals());

describe('ProductSocialShare', () => {
	it.each([
		['shareOnFacebook', `https://www.facebook.com/sharer/sharer.php?u=${encoded}`],
		['shareOnTwitter', `https://twitter.com/intent/tweet?url=${encoded}`],
		['shareOnLinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`],
		['shareOnWhatsApp', `https://api.whatsapp.com/send?text=${encoded}`],
	] as const)('%s opens the share page', (method, url) => {
		const { share, open } = render();
		share[method]('red');
		expect(open).toHaveBeenCalledWith(url, '_blank');
	});

	it('hands off to the mail client', () => {
		const { share, location } = render();
		share.shareViaEmail('red');
		expect(location.href).toContain('mailto:?subject=');
		expect(location.href).toContain(encodeURIComponent('https://shop.test/product/red'));
	});

	it.each(['shareOnFacebook', 'shareOnTwitter', 'shareOnLinkedIn', 'shareOnWhatsApp', 'shareViaEmail'] as const)(
		'%s does nothing on the server',
		(method) => {
			const { share, open, location } = render('server');
			share[method]('red');
			expect(open).not.toHaveBeenCalled();
			expect(location.href).toBe('');
		},
	);
});
