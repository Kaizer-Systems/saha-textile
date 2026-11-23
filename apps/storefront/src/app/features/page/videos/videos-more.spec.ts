import { Location, ViewportScroller } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IChannelVideos, IVideo } from '@data-access/interfaces/video.interface';

import { Videos } from './videos';

const channel = signal<IChannelVideos | undefined>(undefined);
vi.mock('@data-access/queries/youtube.queries', () => ({
	injectChannelVideosQuery: () => ({ data: channel, isSuccess: signal(true) }),
}));
vi.mock('@shared/util/breadcrumb-i18n', () => ({ translatedBreadcrumb: () => () => undefined }));

describe('Videos page: the remaining cases', () => {
	it('has no Shorts before the channel answers, and states no date or length the video lacks', () => {
		const seo = { applyDocument: vi.fn(), applyJsonLd: vi.fn(), removeJsonLd: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: LocaleSeo, useValue: seo },
				{ provide: Location, useValue: { path: () => '/en/videos', replaceState: vi.fn() } },
				{ provide: ViewportScroller, useValue: { scrollToAnchor: vi.fn() } },
				{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
			],
		});
		TestBed.overrideComponent(Videos, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Videos);
		fixture.detectChanges();
		const page = fixture.componentInstance;
		expect(page.shorts()).toEqual([]);
		const bare = { videoId: 'aaaaaaaaaaa', title: 'Saree', thumbnailUrl: '', kind: 'video' } as IVideo;
		channel.set({ videos: [bare], shorts: [], channelUrl: 'https://www.youtube.com/@a' });
		TestBed.tick();
		const data = seo.applyJsonLd.mock.lastCall?.[1] as Record<string, unknown>;
		expect(data).not.toHaveProperty('uploadDate');
		expect(data).not.toHaveProperty('duration');
		expect(page.cardPoster(bare)).toContain('aaaaaaaaaaa');
	});
});
