import { Component, computed, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IVideo } from '@data-access/interfaces/video.interface';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';

import { posterFor, watchUrl } from './video-links';

/**
 * A long video as the theme's blog card (`blog-box`, `blog-box-image`, `blog-detail`), with a
 * play badge made of Bootstrap utilities. The card is a real link to YouTube, so it works with
 * no script; a click opens the shop's own player instead.
 */
@Component({
	selector: 'app-video-card',
	imports: [ShopDatePipe, TranslocoModule],
	template: `
		<div class="blog-box">
			@if (nowPlaying()) {
				<div class="blog-label-tag">
					<span>{{ 'now_playing' | transloco }}</span>
				</div>
			}
			<div class="blog-box-image">
				<a
					class="blog-image d-block position-relative h-auto"
					[href]="link()"
					[attr.aria-label]="'play_video' | transloco: { title: video().title }"
					(click)="pick($event)"
				>
					<span class="ratio ratio-16x9 d-block">
						<img
							class="object-fit-cover"
							[src]="poster()"
							[alt]="video().title"
							lang="en"
							loading="lazy"
							width="320"
							height="180"
						/>
					</span>
					<span
						class="position-absolute translate-middle rounded-circle theme-bg-color d-inline-flex lh-1 fs-4 start-50 top-50 p-2 text-white shadow"
						aria-hidden="true"
					>
						<i class="ri-play-fill"></i>
					</span>
				</a>
			</div>
			<a
				class="blog-detail pt-3"
				[href]="link()"
				(click)="pick($event)"
			>
				@if (video().publishedAt; as published) {
					<h6>{{ published | shopDate }}</h6>
				}
				<h5 lang="en">{{ video().title }}</h5>
			</a>
		</div>
	`,
})
export class VideoCard {
	readonly video = input.required<IVideo>();
	readonly nowPlaying = input(false);
	readonly picked = output<IVideo>();

	readonly poster = computed(() => posterFor(this.video(), 'card'));
	readonly link = computed(() => watchUrl(this.video()));

	pick(event: Event): void {
		event.preventDefault();
		this.picked.emit(this.video());
	}
}
