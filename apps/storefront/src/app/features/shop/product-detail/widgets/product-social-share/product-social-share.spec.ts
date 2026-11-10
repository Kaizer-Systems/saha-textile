import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { NotificationService } from '@data-access/services/notification.service';

import { ProductSocialShare, canSharePictures } from './product-social-share';

const sharing = vi.hoisted(() => ({ data: undefined as unknown as { (): unknown; set(value: unknown): void } }));
vi.mock('@data-access/queries/share.queries', async (original) => ({
	...(await original<object>()),
	injectShareSettingsQuery: () => sharing,
}));

const product = {
	name: 'Katan Saree',
	slug: 'katan',
	price: 5200,
	sale_price: 4680,
	semantic_attributes: [{ value: 'Katan' }, { value: 'Black' }, { value: 'Wedding' }, { value: 'Extra' }],
	product_thumbnail: { original_url: 'https://cdn.test/photo.jpg' },
	share_story_image: { original_url: 'https://cdn.test/tall.jpg' },
};

const render = (options: { platform?: string; phone?: boolean; variant?: string | null; item?: object } = {}) => {
	sharing.data = signal<unknown>(undefined);
	vi.stubGlobal('matchMedia', () => ({ matches: options.phone ?? false }));
	const shared: unknown[] = [];
	vi.stubGlobal('navigator', {
		canShare: () => options.phone ?? false,
		share: vi.fn(async (data: unknown) => void shared.push(data)),
		clipboard: { writeText: vi.fn(async () => undefined) },
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) })),
	);
	const notes = { showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{
				provide: LocaleSeo,
				useValue: {
					absoluteUrl: (path: string) => `https://shop.test/en${path}`,
					absoluteAddress: (path: string) => `https://shop.test${path}`,
				},
			},
			{ provide: NotificationService, useValue: notes },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: object) => (params ? `${key}:${JSON.stringify(params)}` : key),
				},
			},
		],
	});
	TestBed.overrideComponent(ProductSocialShare, { set: { imports: [], template: '', styleUrls: [] } });
	const fixture = TestBed.createComponent(ProductSocialShare);
	fixture.componentRef.setInput('product', { ...product, ...options.item });
	fixture.componentRef.setInput('variantSku', options.variant ?? null);
	return { share: fixture.componentInstance, shared, notes };
};

afterEach(() => vi.unstubAllGlobals());

describe('ProductSocialShare', () => {
	it('builds the message from the live product, with the offer only on sale', () => {
		const { share } = render();
		expect(share.message()).toBe(
			'✨ Katan Saree\n₹4,680 · MRP ₹5,200 (share_off:{"percent":10})\nKatan · Black · Wedding\nshare_see_colours',
		);
		const full = render({ item: { sale_price: 0 } }).share;
		expect(full.message().split('\n')[1]).toBe('₹5,200');
	});

	it('follows Sharing once it loads: fewer apps, and X without hashtags', () => {
		const { share } = render();
		expect(share.groups().flatMap((row) => row.items.map((item) => item.id))).toContain('pin');
		sharing.data.set({ xHandle: 'SahaTextile', hashtags: false, stripText: '', apps: ['x'] });
		const x = share.groups()[0]!.items[0]!;
		expect(share.groups().flatMap((row) => row.items.map((item) => item.id))).toEqual(['x']);
		expect(decodeURIComponent(x.href ?? '')).toContain('text=Katan Saree · ₹4,680&');
		expect(x.href).toContain('via=SahaTextile');
	});

	it('links to the chosen colour', () => {
		expect(render({ variant: 'K 1' }).share.url()).toBe('https://shop.test/en/product/katan?variant=K%201');
		expect(render().share.url()).toBe('https://shop.test/en/product/katan');
	});

	it('groups the lean phone menu, and the full list on a computer', () => {
		expect(
			render({ phone: true })
				.share.groups()
				.map((row) => row.items.map((item) => item.id)),
		).toEqual([['wa'], ['fb', 'ig-post'], ['wa-status', 'ig-story']]);
		expect(
			render()
				.share.groups()
				.map((row) => row.group),
		).toEqual(['send', 'post']);
		expect(render().share.appName('share_app_email')).toBe('share_app_email');
		expect(render().share.appName('X')).toBe('X');
	});

	it('opens a post window on a computer, and lets phones and plain links follow the link', () => {
		const { share } = render();
		const open = vi.fn();
		vi.stubGlobal('open', open);
		const event = { preventDefault: vi.fn() } as unknown as Event;
		const [, facebook] = share.groups()[1]!.items;
		share.open(event, share.groups()[1]!.items[0]!);
		expect(open).toHaveBeenCalledWith(
			expect.stringContaining('facebook.com/sharer'),
			'share-fb',
			'popup,width=640,height=680,noopener',
		);
		share.open(event, share.groups()[0]!.items[0]!);
		expect(open).toHaveBeenCalledOnce();
		expect(facebook?.id).toBe('x');
		render({ phone: true }).share.open(event, {
			id: 'fb',
			group: 'post',
			icon: '',
			app: '',
			label: '',
			window: true,
			href: 'x',
		});
		render({ platform: 'server' }).share.open(event, {
			id: 'wa-status',
			group: 'story',
			icon: '',
			app: '',
			label: '',
			picture: 'tall',
		});
		expect(open).toHaveBeenCalledOnce();
	});

	it('copies the caption, shows the hint and opens the share sheet with the tall card', async () => {
		const { share, shared, notes } = render({ phone: true });
		const status = share.groups()[2]!.items[0]!;
		share.open({ preventDefault: vi.fn() } as unknown as Event, status);
		await vi.waitFor(() => expect(shared).toHaveLength(1));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			expect.stringContaining('https://shop.test/en/product/katan?ref=wa-status'),
		);
		expect(notes.showSuccess).toHaveBeenCalledWith('share_hint_whatsapp_status');
		expect(fetch).toHaveBeenCalledWith('https://cdn.test/tall.jpg');
		expect((shared[0] as { files: File[] }).files[0]?.name).toBe('katan.jpg');
	});

	it('gives Instagram the short address people can type, and WhatsApp the full one', async () => {
		const { share } = render({ phone: true, item: { product_code: 'KATA-1001' } });
		await share.sharePicture({ id: 'ig-post', group: 'post', icon: '', app: '', label: '', picture: 'photo' });
		expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
			expect.stringMatching(/\nshop\.test\/p\/KATA-1001$/),
		);
		await share.sharePicture({ id: 'wa-status', group: 'story', icon: '', app: '', label: '', picture: 'tall' });
		expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
			expect.stringContaining('https://shop.test/en/product/katan?ref=wa-status'),
		);
	});

	it('uses the photo for posts and when the tall card is missing, and still shares the caption without a picture', async () => {
		const { share, shared } = render({ phone: true, item: { share_story_image: undefined } });
		await share.sharePicture({
			id: 'ig-story',
			group: 'story',
			icon: '',
			app: '',
			label: '',
			picture: 'tall',
			hint: 'h',
		});
		expect(fetch).toHaveBeenLastCalledWith('https://cdn.test/photo.jpg');
		const bare = render({ phone: true, item: { product_thumbnail: undefined, share_story_image: undefined } });
		await bare.share.sharePicture({ id: 'ig-post', group: 'post', icon: '', app: '', label: '', picture: 'photo' });
		expect(bare.shared[0]).not.toHaveProperty('files');
		expect(shared).toHaveLength(1);
		const offline = render({ phone: true });
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		await offline.share.sharePicture({
			id: 'ig-post',
			group: 'post',
			icon: '',
			app: '',
			label: '',
			picture: 'photo',
		});
		expect(offline.shared[0]).not.toHaveProperty('files');
	});

	it('opens More with the message and link, and copies the tagged link', async () => {
		const { share, shared, notes } = render({ phone: true });
		share.more();
		share.copyLink();
		await vi.waitFor(() => expect(notes.showSuccess).toHaveBeenCalledWith('link_copied'));
		expect(shared[0]).toMatchObject({ url: 'https://shop.test/en/product/katan?ref=more' });
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://shop.test/en/product/katan?ref=copy');
		const server = render({ platform: 'server' });
		server.share.more();
		server.share.copyLink();
		expect(server.shared).toEqual([]);
	});
});

describe('canSharePictures', () => {
	it('asks the browser whether it can share a picture, and says no when it cannot ask', () => {
		vi.stubGlobal('navigator', { canShare: () => true });
		expect(canSharePictures()).toBe(true);
		vi.stubGlobal('navigator', {
			canShare: () => {
				throw new Error('no');
			},
		});
		expect(canSharePictures()).toBe(false);
		vi.stubGlobal('navigator', {});
		expect(canSharePictures()).toBe(false);
	});
});
