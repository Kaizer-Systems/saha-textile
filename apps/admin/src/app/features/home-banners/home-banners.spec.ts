import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ContentBlocksGateway } from '@core/media/content-blocks.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { BannerSlotForm } from './banner-slot-form/banner-slot-form';
import { HomeBanners } from './home-banners';

const setup = () => {
	const gateway = {
		heroLayout: vi.fn(() => of('hero_main_side')),
		setHeroLayout: vi.fn((layout: string) => of(layout)),
		list: vi.fn((owner: string) =>
			of(
				owner === 'home'
					? [
							{ position: 'hero', slot: 'main' },
							{ position: 'strip', slot: 'x' },
						]
					: [{ position: 'newsletter_popup', slot: 'popup' }],
			),
		),
		save: vi.fn(() => of({})),
		remove: vi.fn(() => of({})),
	};
	const media = { get: vi.fn((id: string) => of({ id })) };
	const notifications = { showSuccess: vi.fn(), showError: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ContentBlocksGateway, useValue: gateway },
			{ provide: MediaGateway, useValue: media },
			{ provide: NotificationService, useValue: notifications },
		],
	});
	return { gateway, media, notifications };
};

describe('HomeBanners', () => {
	const render = () => {
		const parts = setup();
		TestBed.overrideComponent(HomeBanners, { set: { imports: [], template: '' } });
		return { ...parts, page: TestBed.createComponent(HomeBanners).componentInstance };
	};

	it('loads the layout and its blocks', async () => {
		const { page } = render();
		await page.ngOnInit();
		expect(page.loaded()).toBe(true);
		expect(page.layout()).toBe('hero_main_side');
		expect(page.heroBlocks()).toHaveLength(1);
		expect(page.popupBlock()).toMatchObject({ slot: 'popup' });
		expect(page.slots().length).toBeGreaterThan(0);
		expect(page.block('main')).toMatchObject({ slot: 'main' });
		expect(page.block('none')).toBeNull();
	});

	it('copes with no popup block', async () => {
		const { page, gateway } = render();
		gateway.list.mockReturnValue(of([]));
		await page.reload();
		expect(page.popupBlock()).toBeNull();
	});

	it('saves a layout and reports a failure', async () => {
		const { page, gateway, notifications } = render();
		await page.chooseLayout('hero_full');
		expect(page.layout()).toBe('hero_full');
		expect(notifications.showSuccess).toHaveBeenCalledOnce();
		gateway.setHeroLayout.mockReturnValue(throwError(() => new Error('no')));
		await page.chooseLayout('hero_main_stack');
		expect(page.layout()).toBe('hero_full');
		expect(notifications.showError).toHaveBeenCalledOnce();
	});
});

const block = (overrides: Record<string, unknown> = {}) => ({
	key: 'k1',
	images: { desktop: 'd1', tablet: null, phone: 'p1' },
	containsText: false,
	localeImages: { fr: { desktop: 'f1' } },
	heading: { en: 'Hi', fr: '' },
	subheading: { en: '', fr: '' },
	ctaLabel: { en: '', fr: '' },
	alt: { en: 'Alt', fr: '' },
	link: { href: '/shop', external: true },
	status: 'active',
	startsAt: '2026-11-01T10:30:00.000Z',
	endsAt: null,
	...overrides,
});

describe('BannerSlotForm', () => {
	const render = async (existing: unknown = null, slot = 'main', position = 'hero') => {
		const parts = setup();
		TestBed.overrideComponent(BannerSlotForm, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BannerSlotForm);
		fixture.componentRef.setInput('slot', slot);
		fixture.componentRef.setInput('position', position);
		fixture.componentRef.setInput('existing', existing);
		return { ...parts, fixture, page: fixture.componentInstance };
	};

	it('stays blank without a block', async () => {
		const { page, media } = await render();
		await page.ngOnInit();
		expect(page.form.value.desktop).toBeNull();
		expect(media.get).not.toHaveBeenCalled();
	});

	it('fills from a block and loads its previews', async () => {
		const { page, media } = await render(block());
		await page.ngOnInit();
		expect(page.form.getRawValue()).toMatchObject({
			desktop: 'd1',
			linkHref: '/shop',
			linkExternal: true,
			startsAt: '2026-11-01T10:30',
			endsAt: '',
		});
		expect(media.get).toHaveBeenCalledTimes(2);
		expect(page.previews()).toEqual({ desktop: { id: 'd1' }, tablet: null, phone: { id: 'p1' } });
	});

	it('survives a block with no link and a preview that fails', async () => {
		const { page, media } = await render(block({ link: null }));
		media.get.mockReturnValue(throwError(() => new Error('gone')));
		await page.ngOnInit();
		expect(page.form.getRawValue()).toMatchObject({ linkHref: '', linkExternal: false });
		expect(page.previews().desktop).toBeNull();
	});

	it('takes a picked image from a single value or a list', async () => {
		const { page } = await render();
		page.pick('desktop', { id: 5 } as never);
		expect(page.form.value.desktop).toBe('5');
		page.pick('tablet', [{ id: 6 }] as never);
		expect(page.form.value.tablet).toBe('6');
		page.pick('tablet', [] as never);
		expect(page.form.value.tablet).toBeNull();
		page.pick('phone', null);
		expect(page.previews().phone).toBeNull();
	});

	it('needs a desktop image', async () => {
		const { page, gateway, notifications } = await render();
		await page.save();
		expect(notifications.showError).toHaveBeenCalledWith('Choose a desktop image first.');
		expect(gateway.save).not.toHaveBeenCalled();
	});

	it('needs a phone image only for text art on a wide slot', async () => {
		const wide = await render();
		expect(wide.page.phoneRequired).toBe(false);
		wide.page.form.patchValue({ desktop: 'd', containsText: true });
		expect(wide.page.phoneRequired).toBe(true);
		await wide.page.save();
		expect(wide.notifications.showError).toHaveBeenCalledWith(
			'This slot needs a phone image when the art contains text.',
		);
		wide.page.form.patchValue({ phone: 'p' });
		await wide.page.save();
		expect(wide.gateway.save).toHaveBeenCalledOnce();
		const narrow = await render(null, 'side');
		narrow.page.form.patchValue({ containsText: true });
		expect(narrow.page.phoneRequired).toBe(false);
	});

	it('saves plain art with cleaned text, a link and dates', async () => {
		const { page, gateway, notifications } = await render(block());
		const saved = vi.fn();
		page.saved.subscribe(saved);
		await page.ngOnInit();
		page.form.patchValue({ linkHref: ' /sale ', startsAt: '2026-11-01T10:30', endsAt: '' });
		await page.save();
		const sent = (gateway.save.mock.lastCall as unknown[])[0];
		expect(sent).toMatchObject({
			ownerType: 'home',
			position: 'hero',
			slot: 'main',
			heading: { en: 'Hi' },
			subheading: {},
			alt: { en: 'Alt' },
			link: { href: '/sale', external: true },
			localeImages: { fr: { desktop: 'f1' } },
			endsAt: null,
		});
		expect((sent as { startsAt: string }).startsAt).toContain('2026-11-01');
		expect(notifications.showSuccess).toHaveBeenCalledWith('Banner saved.');
		expect(saved).toHaveBeenCalledOnce();
		expect(page.saving()).toBe(false);
	});

	it('drops text and link when the art holds the text', async () => {
		const { page, gateway } = await render(null, 'side');
		page.form.patchValue({ desktop: 'd', containsText: true, heading: { en: 'Hi', fr: '' } });
		await page.save();
		expect(gateway.save).toHaveBeenCalledWith(
			expect.objectContaining({ heading: {}, subheading: {}, ctaLabel: {}, link: null, localeImages: {} }),
		);
	});

	it('shows the refusal, joined or plain', async () => {
		const { page, gateway, notifications } = await render();
		page.form.patchValue({ desktop: 'd' });
		gateway.save.mockReturnValue(throwError(() => ({ error: { message: ['One', 'Two'] } })));
		await page.save();
		expect(notifications.showError).toHaveBeenLastCalledWith('One Two');
		gateway.save.mockReturnValue(throwError(() => ({})));
		await page.save();
		expect(notifications.showError).toHaveBeenLastCalledWith('The banner could not be saved.');
		expect(page.saving()).toBe(false);
	});

	it('removes a saved block only', async () => {
		const empty = await render();
		await empty.page.remove();
		expect(empty.gateway.remove).not.toHaveBeenCalled();
		const { page, gateway, notifications } = await render(block());
		const saved = vi.fn();
		page.saved.subscribe(saved);
		await page.remove();
		expect(gateway.remove).toHaveBeenCalledWith('k1');
		expect(notifications.showSuccess).toHaveBeenCalledWith('Banner removed.');
		expect(saved).toHaveBeenCalledOnce();
	});
});
