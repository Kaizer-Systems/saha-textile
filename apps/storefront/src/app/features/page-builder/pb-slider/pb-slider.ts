import { isPlatformBrowser } from '@angular/common';
import {
	afterNextRender,
	Component,
	computed,
	DestroyRef,
	ElementRef,
	inject,
	input,
	PLATFORM_ID,
	signal,
	viewChild,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ImageLink } from '@shared/ui/image-link/image-link';

import type { ResolvedPieceView } from '../page-builder.types';

/**
 * One piece holding two or more pictures (Page Builder B3, F1–F4; custom part approved with the brief). The
 * browser's own scroll-snap does the moving, so every picture and its link is in the HTML once (no copies, FX-12)
 * and still swipes with no script. One control pill sits inside the picture on its own dark backing: pause first
 * (FX-3, WCAG 2.2.2), previous, one bar per picture, next. It turns by itself only when the visitor has not asked
 * for less motion, and stops while hovered, focused or off screen. Only the first picture may be the page's early
 * picture; the rest load as they come near.
 */
@Component({
	selector: 'app-pb-slider',
	templateUrl: './pb-slider.html',
	styleUrls: ['./pb-slider.scss'],
	imports: [ImageLink, TranslocoModule],
})
export class PbSlider {
	readonly piece = input.required<ResolvedPieceView>();
	/** This piece holds the page's one early picture (the first section's first picture). */
	readonly early = input(false);
	readonly sizes = input('100vw');

	readonly index = signal(0);
	readonly paused = signal(false);
	private readonly held = signal(false);
	readonly count = computed(() => this.piece().pictures.length);

	private readonly track = viewChild<ElementRef<HTMLElement>>('track');
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		const browser = isPlatformBrowser(inject(PLATFORM_ID));
		const destroyRef = inject(DestroyRef);
		destroyRef.onDestroy(() => this.stopTimer());
		afterNextRender(() => {
			if (!browser) return;
			const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
			if (reduce) this.paused.set(true);
			this.startTimer();
		});
	}

	toggle(): void {
		this.paused.update((paused) => !paused);
	}

	hold(on: boolean): void {
		this.held.set(on);
	}

	go(to: number): void {
		const count = this.count();
		const last = count - 1;
		const next = this.piece().slider.after === 'stop' ? Math.max(0, Math.min(last, to)) : (to + count) % count;
		const track = this.track()?.nativeElement;
		if (track) track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
		this.index.set(next);
	}

	/** The picture in view after a swipe or a scroll by the browser. */
	onScroll(): void {
		const track = this.track()?.nativeElement;
		if (!track || track.clientWidth === 0) return;
		this.index.set(Math.round(track.scrollLeft / track.clientWidth));
	}

	private startTimer(): void {
		this.stopTimer();
		const seconds = this.piece().slider.seconds;
		this.timer = setInterval(() => {
			if (this.paused() || this.held() || document.hidden) return;
			if (this.piece().slider.after === 'stop' && this.index() >= this.count() - 1) {
				this.paused.set(true);
				return;
			}
			this.go(this.index() + 1);
		}, seconds * 1000);
	}

	private stopTimer(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
