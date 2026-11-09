import { PLATFORM_ID, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IVideo } from '@data-access/interfaces/video.interface';

import { ShortCard } from './short-card';
import { ShortsModal } from './shorts-modal';
import { VideoCard } from './video-card';
import { isoDuration, posterFor, watchUrl } from './video-links';
import { VideoModal } from './video-modal';
import { VideoPoster } from './video-poster';

vi.mock('@videojs/html/video/player', () => ({}));
vi.mock('@videojs/html/video/skin', () => ({}));
vi.mock('@videojs/html/media/youtube-video', () => ({}));

const video = (videoId: string, kind: 'video' | 'short' = 'video', thumbnailUrl = ''): IVideo => ({
	videoId,
	title: `Title ${videoId}`,
	thumbnailUrl,
	kind,
	durationSeconds: kind === 'short' ? 48 : 1521,
});

const make = <T>(type: Type<T>, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '', styles: [], styleUrls: [] } });
	return TestBed.createComponent(type);
};

afterEach(() => vi.unstubAllGlobals());

describe('video links', () => {
	it('links a video to /watch and a Short to /shorts', () => {
		expect(watchUrl(video('a'))).toBe('https://www.youtube.com/watch?v=a');
		expect(watchUrl(video('b', 'short'))).toBe('https://www.youtube.com/shorts/b');
	});

	it('keeps our CDN copy, and picks the right YouTube picture for the place', () => {
		expect(posterFor(video('a', 'video', 'https://cdn.test/a.jpg'), 'card')).toBe('https://cdn.test/a.jpg');
		expect(posterFor(video('a', 'short', 'https://i.ytimg.com/vi/a/hq.jpg'), 'card')).toBe(
			'https://i.ytimg.com/vi/a/oar2.jpg',
		);
		expect(posterFor(video('a', 'video', 'https://i.ytimg.com/vi/a/maxresdefault.jpg'), 'card')).toBe(
			'https://i.ytimg.com/vi/a/mqdefault.jpg',
		);
		expect(posterFor(video('a', 'video', 'https://i.ytimg.com/vi/a/maxresdefault.jpg'), 'large')).toBe(
			'https://i.ytimg.com/vi/a/maxresdefault.jpg',
		);
		expect(posterFor(video('a'), 'large')).toBe('https://i.ytimg.com/vi/a/hqdefault.jpg');
	});

	it.each([
		[1521, 'PT25M21S'],
		[48, 'PT48S'],
		[3600, 'PT1H'],
		[3723, 'PT1H2M3S'],
		[0, 'PT0S'],
	])('writes %i seconds as %s', (seconds, text) => expect(isoDuration(seconds)).toBe(text));
});

describe('VideoPoster', () => {
	const poster = (platform = 'browser', autostart = false, value = video('a')) => {
		const fixture = make(VideoPoster, [{ provide: PLATFORM_ID, useValue: platform }]);
		fixture.componentRef.setInput('video', value);
		fixture.componentRef.setInput('autostart', autostart);
		return fixture;
	};

	it('loads the player only when play is pressed, and says so', async () => {
		const fixture = poster();
		const player = fixture.componentInstance;
		const started = vi.fn();
		player.started.subscribe(started);
		expect(player.state()).toBe('poster');
		expect(player.vertical()).toBe(false);
		await player.play();
		expect(player.state()).toBe('playing');
		expect(started).toHaveBeenCalledOnce();
		player.stop();
		expect(player.state()).toBe('poster');
		player.stop();
		expect(player.state()).toBe('poster');
	});

	it('plays nothing on the server', async () => {
		const player = poster('server').componentInstance;
		await player.play();
		expect(player.state()).toBe('poster');
	});

	it('says it is offline instead of loading anything', async () => {
		vi.stubGlobal('navigator', { onLine: false });
		const player = poster().componentInstance;
		await player.play();
		expect(player.state()).toBe('offline');
	});

	it('shows a gone video as gone, and starts on its own when asked', async () => {
		const fixture = poster('browser', true, video('s', 'short'));
		fixture.detectChanges();
		await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('playing'));
		expect(fixture.componentInstance.vertical()).toBe(true);
		expect(fixture.componentInstance.youtubeUrl()).toBe('https://www.youtube.com/shorts/s');
		fixture.componentInstance.failed();
		expect(fixture.componentInstance.state()).toBe('gone');
	});
});

describe('video cards', () => {
	it.each([VideoCard, ShortCard])('%o hands the picked video up instead of following the link', (type) => {
		const fixture = make(type as Type<VideoCard>);
		fixture.componentRef.setInput('video', video('a'));
		const picked = vi.fn();
		fixture.componentInstance.picked.subscribe(picked);
		const event = { preventDefault: vi.fn() } as unknown as Event;
		fixture.componentInstance.pick(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(picked).toHaveBeenCalledWith(video('a'));
		expect(fixture.componentInstance.link()).toBe('https://www.youtube.com/watch?v=a');
		expect(fixture.componentInstance.poster()).toBe('https://i.ytimg.com/vi/a/mqdefault.jpg');
	});
});

describe('video popups', () => {
	const modals = { open: vi.fn() };

	it('opens a video extra large', () => {
		const popup = make(VideoModal, [{ provide: NgbModal, useValue: modals }]).componentInstance;
		expect(popup.link()).toBe('');
		popup.open(video('a'));
		expect(popup.video()).toEqual(video('a'));
		expect(popup.link()).toBe('https://www.youtube.com/watch?v=a');
		expect(modals.open).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ size: 'xl' }));
	});

	it('steps through its own Shorts, starting at the one picked, and stops at either end', () => {
		const popup = make(ShortsModal, [{ provide: NgbModal, useValue: modals }]).componentInstance;
		const list = [video('a', 'short'), video('b', 'short'), video('c', 'short')];
		popup.open(list, list[1]!);
		expect(modals.open).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ fullscreen: 'sm' }));
		expect(popup.current()?.videoId).toBe('b');
		popup.next();
		popup.next();
		expect(popup.current()?.videoId).toBe('c');
		popup.previous();
		popup.previous();
		popup.previous();
		expect(popup.current()?.videoId).toBe('a');
		popup.open(list, video('zzz', 'short'));
		expect(popup.index()).toBe(0);
		popup.open([], video('zzz', 'short'));
		expect(popup.current()).toBeNull();
	});
});
