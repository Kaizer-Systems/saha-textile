import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { ContentBlocksGateway } from '@core/media/content-blocks.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { BannerSlotForm } from './banner-slot-form/banner-slot-form';
import { HomeBanners } from './home-banners';

function configure(query: Record<string, string> = {}) {
	const params = new BehaviorSubject(convertToParamMap(query));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ContentBlocksGateway,
				useValue: { heroLayout: () => of('hero_main_side'), list: () => of([]) },
			},
			{ provide: MediaGateway, useValue: { get: vi.fn((id: string) => of({ id, original_url: `${id}.webp` })) } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
			{ provide: AdminLanguagesGateway, useValue: { missing: () => of({ ids: ['blk_2'] }) } },
		],
	});
}

describe('home banners filtered to one language’s missing text', () => {
	it('shows only the slots whose banner still lacks it, and never an empty slot', () => {
		configure({ missing: 'bn' });
		TestBed.overrideComponent(HomeBanners, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(HomeBanners).componentInstance;
		TestBed.tick();
		expect(page.shows({ id: 'blk_2' } as never)).toBe(true);
		expect(page.shows({ id: 'blk_1' } as never)).toBe(false);
		expect(page.shows(null)).toBe(false);
	});
});

describe('a banner whose picture was chosen with a version', () => {
	it('previews the picture with that version', async () => {
		configure();
		TestBed.overrideComponent(BannerSlotForm, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BannerSlotForm);
		fixture.componentRef.setInput('slot', 'main');
		fixture.componentRef.setInput('position', 'hero');
		fixture.componentRef.setInput('existing', {
			key: 'k1',
			images: { desktop: 'd1', tablet: null, phone: null },
			imageVersions: { d1: 'hero_21x9.crop' },
			containsText: false,
			heading: { en: '' },
			subheading: { en: '' },
			ctaLabel: { en: '' },
			alt: { en: 'Alt' },
			link: null,
			status: 'active',
			startsAt: null,
			endsAt: null,
		});
		await fixture.componentInstance.ngOnInit();
		expect(fixture.componentInstance.previews()['desktop']).toMatchObject({
			id: 'd1',
			versionId: 'hero_21x9.crop',
		});
	});
});
