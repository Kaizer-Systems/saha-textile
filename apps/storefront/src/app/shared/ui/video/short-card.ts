import { Component, computed, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IVideo } from '@data-access/interfaces/video.interface';

import { posterFor, watchUrl } from './video-links';

/** A Short as the same blog card in 9:16, with no date: Shorts come in bursts per episode. */
@Component({
	selector: 'app-short-card',
	imports: [TranslocoModule],
	template: `
		<div class="blog-box">
			<div class="blog-box-image">
				<a
					class="blog-image d-block position-relative h-auto"
					[href]="link()"
					[attr.aria-label]="'play_short' | transloco: { title: video().title }"
					(click)="pick($event)"
				>
					<span class="ratio ratio-9x16 d-block">
						<img
							class="object-fit-cover"
							[src]="poster()"
							[alt]="video().title"
							lang="en"
							loading="lazy"
							width="270"
							height="480"
						/>
					</span>
					<span
						class="position-absolute translate-middle rounded-circle theme-bg-color d-inline-flex lh-1 fs-5 start-50 top-50 p-2 text-white shadow"
						aria-hidden="true"
					>
						<i class="ri-play-fill"></i>
					</span>
				</a>
			</div>
			<a
				class="blog-detail pt-2"
				[href]="link()"
				(click)="pick($event)"
			>
				<h5 lang="en">{{ video().title }}</h5>
			</a>
		</div>
	`,
	styles: `
		/* Bootstrap's custom-ratio variable for 9:16 (it ships none). */
		.ratio-9x16 {
			--bs-aspect-ratio: 177.78%;
		}
	`,
})
export class ShortCard {
	readonly video = input.required<IVideo>();
	readonly picked = output<IVideo>();

	readonly poster = computed(() => posterFor(this.video(), 'card'));
	readonly link = computed(() => watchUrl(this.video()));

	pick(event: Event): void {
		event.preventDefault();
		this.picked.emit(this.video());
	}
}
