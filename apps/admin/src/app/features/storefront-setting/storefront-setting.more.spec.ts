import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { YouTubeGateway } from '@core/media/content-blocks.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { SearchTermService } from '@data-access/services/search-term.service';

import { StorefrontSetting } from './storefront-setting';

vi.mock('@data-access/queries/search-term.queries', () => ({
	injectStorefrontSearchSettingsQuery: () => ({ data: () => undefined }),
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => (params(), { data: () => undefined }),
}));

function render() {
	const query = new BehaviorSubject(convertToParamMap({}));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: { queryParamMap: query } },
			{
				provide: SearchTermService,
				useValue: { getShareSettings: () => of({ xHandle: '', hashtags: true, apps: ['whatsapp'] }) },
			},
			{
				provide: YouTubeGateway,
				useValue: {
					settings: () =>
						of({
							channelHandle: '',
							channelId: null,
							uploadsPlaylistId: null,
							displayCount: 8,
							railPlacements: [],
						}),
					status: () => of(null),
				},
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
		],
	});
	TestBed.overrideComponent(StorefrontSetting, { set: { imports: [], template: '' } });
	return { page: TestBed.createComponent(StorefrontSetting).componentInstance, query };
}

describe('Storefront settings: the tab from the address, and no categories yet', () => {
	it('opens only a tab it has, and offers no categories before they load', () => {
		const { page, query } = render();
		expect(page.active).toBe('search');
		query.next(convertToParamMap({ tab: 'secret' }));
		expect(page.active).toBe('search');
		query.next(convertToParamMap({ tab: 'share' }));
		expect(page.active).toBe('share');
		expect(page.categories()).toEqual([]);
		page.selectShowFirst(null as never);
		expect(page.showFirst()).toEqual([]);
	});
});
