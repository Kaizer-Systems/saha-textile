import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { NotificationService } from '@data-access/services/notification.service';

import { ProductSocialShare } from './product-social-share';

import type { ShareTarget } from './share-targets';

const brand = vi.hoisted(() => ({ data: (): unknown => null }));
const story = vi.hoisted(() => ({
	write: vi.fn(async (card: Blob, _words: unknown, _font: string) => card),
	jpeg: vi.fn(async (photo: Blob) => photo),
}));
vi.mock('@data-access/queries/brand.queries', () => ({ injectBrandQuery: () => brand }));
vi.mock('./story-card', async (original) => ({
	...(await original<object>()),
	writeStoryWords: story.write,
	asJpeg: story.jpeg,
}));
vi.mock('@data-access/queries/share.queries', async (original) => ({
	...(await original<object>()),
	injectShareSettingsQuery: () => ({ data: signal(undefined) }),
}));

const product = {
	name: 'Katan Saree',
	slug: 'katan',
	price: 5200,
	sale_price: 0,
	product_thumbnail: { original_url: 'https://cdn.test/photo' },
	share_story_image: { original_url: 'https://cdn.test/tall' },
};

const failing = async () => {
	throw new Error('dismissed');
};

const render = () => {
	vi.stubGlobal('matchMedia', () => ({ matches: false }));
	const share = vi.fn(failing);
	vi.stubGlobal('navigator', { canShare: () => false, share, clipboard: { writeText: vi.fn(failing) } });
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ blob: async () => new Blob(['x']) })),
	);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: 'browser' },
			{
				provide: LocaleSeo,
				useValue: {
					absoluteUrl: (path: string) => `https://shop.test/en${path}`,
					absoluteAddress: (path: string) => `https://shop.test${path}`,
				},
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(ProductSocialShare, { set: { imports: [], template: '', styleUrls: [] } });
	const fixture = TestBed.createComponent(ProductSocialShare);
	fixture.componentRef.setInput('product', product);
	return { component: fixture.componentInstance, share };
};

const target = (over: Partial<ShareTarget>): ShareTarget =>
	({ id: 'wa-status', group: 'story', icon: '', app: '', label: '', picture: 'tall', ...over }) as ShareTarget;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	story.write.mockClear();
});

describe('ProductSocialShare: when things are missing or refused', () => {
	it('prices at full price with no offer, and lists no facts when the product has none', () => {
		const { component } = render();
		expect(component.message()).toBe('✨ Katan Saree\n₹5,200\nshare_see_colours');
		expect(component.groups().length).toBeGreaterThan(0);
	});

	it('writes the address alone on the card without a shop name, in a plain font, and shares a typeless picture as JPEG', async () => {
		vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontFamily: '' } as CSSStyleDeclaration);
		const { component, share } = render();
		await component.sharePicture(target({}));
		expect(story.write).toHaveBeenCalledWith(
			expect.any(Blob),
			{ name: 'Katan Saree', facts: '', shop: 'shop.test' },
			'sans-serif',
		);
		const sent = share.mock.calls[0] as unknown as [{ files: File[] }];
		expect(sent[0].files[0]?.type).toBe('image/jpeg');
		expect(sent[0].files[0]?.name).toBe('katan.jpg');
	});

	it('carries on quietly when the copy or the share sheet is refused', async () => {
		const { component, share } = render();
		await expect(component.sharePicture(target({ picture: 'photo', id: 'ig-post' }))).resolves.toBeUndefined();
		expect(share).toHaveBeenCalledOnce();
		component.more();
		await Promise.resolve();
		expect(share).toHaveBeenCalledTimes(2);
	});
});
