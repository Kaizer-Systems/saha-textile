import { Component, computed, input } from '@angular/core';

import { CarouselModule } from 'ngx-owl-carousel-o';

import { injectVideoRailQuery } from '@data-access/queries/youtube.queries';
import { blogSliderNav } from '@shared/data/owl-carousel';
import { Title } from '@shared/ui/title/title';
import { VideoCard } from '@shared/ui/video/video-card';
import { VideoModal } from '@shared/ui/video/video-modal';

import { type ResolvedPageSectionView, sectionContainer } from '../page-builder.types';

/** The channel's latest videos (today's home rail): posters only, the player loads on a tap. */
@Component({
	selector: 'app-pb-videos',
	imports: [CarouselModule, Title, VideoCard, VideoModal],
	template: `
		@if (videos().length) {
			<div [class]="container()">
				<app-title
					[title]="section().title ?? ''"
					[description]="section().description ?? ''"
				/>
				<div class="product-arrow">
					<owl-carousel-o [options]="slider">
						@for (video of videos(); track video.videoId) {
							<ng-template carouselSlide>
								<app-video-card
									[video]="video"
									(picked)="modal.open($event)"
								/>
							</ng-template>
						}
					</owl-carousel-o>
				</div>
			</div>
			<app-video-modal #modal />
		}
	`,
})
export class PbVideos {
	readonly section = input.required<ResolvedPageSectionView>();
	private readonly rail = injectVideoRailQuery(() => 'home');
	readonly videos = computed(() => this.rail.data() ?? []);
	readonly slider = blogSliderNav;
	readonly container = computed(() => sectionContainer(this.section()));
}
