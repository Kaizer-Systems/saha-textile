import { isPlatformBrowser } from '@angular/common';
import {
	CUSTOM_ELEMENTS_SCHEMA,
	Component,
	PLATFORM_ID,
	afterNextRender,
	computed,
	inject,
	input,
	output,
	signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IVideo } from '@data-access/interfaces/video.interface';

import { posterFor, watchUrl } from './video-links';

/**
 * Click-to-load YouTube player (owner, 2026-11-10: Video.js 10, `youtube-nocookie`, `rel=0`).
 *
 * The server renders a poster button inside Bootstrap's `.ratio` box, so the size is fixed before
 * any script runs and nothing shifts. Only the click loads the player script and creates the
 * YouTube iframe; that click is the shopper's consent for that one video (cookie list:
 * Functional). Offline, or for a video that has gone, the box says so and links to YouTube.
 */
@Component({
	selector: 'app-video-poster',
	schemas: [CUSTOM_ELEMENTS_SCHEMA],
	imports: [TranslocoModule],
	templateUrl: './video-poster.html',
	styleUrls: ['./video-poster.scss'],
})
export class VideoPoster {
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	readonly video = input.required<Pick<IVideo, 'videoId' | 'title' | 'kind' | 'thumbnailUrl'>>();
	/** The first screen's poster loads at once; the rest wait until scrolled near. */
	readonly priority = input(false);
	/** Start playing on its own (the next Short after one ends). */
	readonly autostart = input(false);
	readonly ended = output<void>();
	readonly started = output<void>();

	readonly state = signal<'poster' | 'playing' | 'offline' | 'gone'>('poster');
	readonly vertical = computed(() => this.video().kind === 'short');
	readonly poster = computed(() => posterFor(this.video(), 'large'));
	readonly youtubeUrl = computed(() => watchUrl(this.video()));

	constructor() {
		afterNextRender(() => {
			if (this.autostart()) void this.play();
		});
	}

	/** Removes the player, so the sound stops, and shows the poster again. */
	stop(): void {
		if (this.state() === 'playing') this.state.set('poster');
	}

	async play(): Promise<void> {
		if (!this.isBrowser) return;
		if (!navigator.onLine) {
			this.state.set('offline');
			return;
		}
		await Promise.all([
			import('@videojs/html/video/player'),
			import('@videojs/html/video/skin'),
			import('@videojs/html/media/youtube-video'),
		]);
		this.state.set('playing');
		this.started.emit();
	}

	/** YouTube refused the video (made private or deleted since the last refresh). */
	failed(): void {
		this.state.set('gone');
	}
}
