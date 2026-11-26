import { Location, ViewportScroller } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IChannelVideos, IVideo } from '@data-access/interfaces/video.interface';

import { Videos } from './videos';

const channel = signal<IChannelVideos | undefined>(undefined);
const success = signal(false);
vi.mock('@data-access/queries/youtube.queries', () => ({
	injectChannelVideosQuery: () => ({ data: channel, isSuccess: success }),
}));
vi.mock('@shared/util/breadcrumb-i18n', () => ({ translatedBreadcrumb: () => () => undefined }));

const video = (videoId: string, kind: 'video' | 'short' = 'video'): IVideo => ({
	videoId,
	title: `Title ${videoId}`,
	thumbnailUrl: '',
	kind,
	durationSeconds: 1521,
	publishedAt: '2026-11-01T00:00:00Z',
});
const list = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff'].map((id) =>
	video(id),
);

const render = (query: Record<string, string> = {}, path = '/en/videos') => {
	const seo = { applyDocument: vi.fn(), applyJsonLd: vi.fn(), removeJsonLd: vi.fn() };
	const location = { path: vi.fn(() => path), replaceState: vi.fn() };
	const scroller = { scrollToAnchor: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: LocaleSeo, useValue: seo },
			{ provide: Location, useValue: location },
			{ provide: ViewportScroller, useValue: scroller },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
		],
	});
	TestBed.overrideComponent(Videos, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Videos);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, seo, location, scroller };
};

afterEach(() => {
	channel.set(undefined);
	success.set(false);
});

describe('Videos page', () => {
	it('shows the newest video, the next four after it, and its VideoObject data', () => {
		channel.set({
			videos: list,
			shorts: [video('sssssssssss', 'short')],
			channelUrl: 'https://www.youtube.com/@a',
		});
		success.set(true);
		const { fixture, page, seo } = render();
		fixture.detectChanges();
		expect(page.current()?.videoId).toBe('aaaaaaaaaaa');
		expect(page.upNext().map((row) => row.videoId)).toEqual(list.slice(1, 5).map((row) => row.videoId));
		expect(page.empty()).toBe(false);
		expect(page.channelUrl()).toBe('https://www.youtube.com/@a');
		expect(seo.applyJsonLd).toHaveBeenCalledWith(
			'video-featured',
			expect.objectContaining({
				'@type': 'VideoObject',
				duration: 'PT25M21S',
				uploadDate: '2026-11-01T00:00:00Z',
				embedUrl: 'https://www.youtube-nocookie.com/embed/aaaaaaaaaaa',
			}),
		);
		expect(seo.applyDocument).not.toHaveBeenCalled();
		fixture.destroy();
		expect(seo.removeJsonLd).toHaveBeenCalledWith('video-featured');
	});

	it('opens on the video and the tab in the address, and wraps Up next round', () => {
		channel.set({ videos: list, shorts: [], channelUrl: 'https://www.youtube.com/@a' });
		const { page } = render({ v: 'fffffffffff', tab: 'shorts' });
		expect(page.tab()).toBe('shorts');
		expect(page.current()?.videoId).toBe('fffffffffff');
		expect(page.upNext().map((row) => row.videoId)).toEqual(list.slice(0, 4).map((row) => row.videoId));
	});

	it('falls back to the newest for an unknown video, and keeps the address in step without navigating', () => {
		channel.set({ videos: list, shorts: [], channelUrl: 'https://www.youtube.com/@a' });
		const { page, location, scroller } = render({ v: 'zzzzzzzzzzz' }, '/en/videos?v=zzzzzzzzzzz');
		expect(page.current()?.videoId).toBe('aaaaaaaaaaa');
		const event = { preventDefault: vi.fn() } as unknown as Event;
		page.pick(list[2]!, event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(page.current()?.videoId).toBe('ccccccccccc');
		expect(location.replaceState).toHaveBeenLastCalledWith('/en/videos', 'v=ccccccccccc');
		expect(scroller.scrollToAnchor).toHaveBeenCalledWith('videos-switcher');
		page.setTab('shorts');
		expect(location.replaceState).toHaveBeenLastCalledWith('/en/videos', 'v=zzzzzzzzzzz&tab=shorts');
		page.setTab('videos');
		expect(location.replaceState).toHaveBeenLastCalledWith('/en/videos', 'v=zzzzzzzzzzz');
		page.pick(list[0]!);
		expect(page.current()?.videoId).toBe('aaaaaaaaaaa');
	});

	it('says so and stays out of search when nothing is cached', () => {
		channel.set({ videos: [], shorts: [], channelUrl: 'https://www.youtube.com/@a' });
		success.set(true);
		const { page, seo } = render();
		expect(page.empty()).toBe(true);
		expect(page.current()).toBeNull();
		expect(page.upNext()).toEqual([]);
		expect(seo.applyDocument).toHaveBeenCalledWith({ robots: 'noindex,follow' });
		expect(seo.applyJsonLd).not.toHaveBeenCalled();
	});

	it('waits for the answer before calling the page empty', () => {
		const { page } = render();
		expect(page.loaded()).toBe(false);
		expect(page.empty()).toBe(false);
		expect(page.videos()).toEqual([]);
		expect(page.channelUrl()).toBe('https://www.youtube.com/@SahaTextile');
	});
});
