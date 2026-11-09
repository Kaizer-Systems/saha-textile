import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { IVideo } from '@data-access/interfaces/video.interface';
import { ShortsModal } from '@shared/ui/video/shorts-modal';
import { VideoModal } from '@shared/ui/video/video-modal';

import { ProductGallery } from './product-gallery';

const video = (videoId: string, kind: 'video' | 'short'): IVideo => ({
	videoId,
	title: videoId,
	thumbnailUrl: '',
	kind,
	durationSeconds: 60,
});

const render = (videos?: IVideo[]) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: NgbModal, useValue: { open: vi.fn() } }] });
	TestBed.overrideComponent(ProductGallery, {
		set: { imports: [VideoModal, ShortsModal], template: '<app-video-modal /><app-shorts-modal />' },
	});
	TestBed.overrideComponent(VideoModal, { set: { imports: [], template: '' } });
	TestBed.overrideComponent(ShortsModal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductGallery);
	if (videos) fixture.componentRef.setInput('product', { videos });
	fixture.detectChanges();
	return fixture.componentInstance;
};

describe('ProductGallery videos', () => {
	it('has no tiles for a product without videos', () => {
		expect(render().videos()).toEqual([]);
		expect(render([]).videos()).toEqual([]);
	});

	it('opens a video in the wide popup, and a Short in the vertical one with only the Shorts', () => {
		const long = video('aaaaaaaaaaa', 'video');
		const first = video('bbbbbbbbbbb', 'short');
		const second = video('ccccccccccc', 'short');
		const gallery = render([long, first, second]);
		const wide = vi.spyOn(gallery.videoModal()!, 'open');
		const tall = vi.spyOn(gallery.shortsModal()!, 'open');
		gallery.playVideo(long);
		expect(wide).toHaveBeenCalledWith(long);
		gallery.playVideo(second);
		expect(tall).toHaveBeenCalledWith([first, second], second);
		expect(gallery.poster(first)).toBe('https://i.ytimg.com/vi/bbbbbbbbbbb/oar2.jpg');
	});
});
