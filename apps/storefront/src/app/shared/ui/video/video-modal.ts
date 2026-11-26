import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { IVideo } from '@data-access/interfaces/video.interface';
import { Button } from '@shared/ui/button/button';

import { watchUrl } from './video-links';
import { VideoPoster } from './video-poster';

/** A long video in the size-chart modal's shell (`theme-modal`, header and close), extra large. */
@Component({
	selector: 'app-video-modal',
	imports: [Button, VideoPoster, TranslocoModule],
	template: `
		<ng-template
			#videoModal
			let-modal
		>
			<div class="modal-header">
				<h3
					class="fw-semibold"
					lang="en"
				>
					{{ video()?.title }}
				</h3>
				<app-button
					[class]="'btn btn-close'"
					[spinner]="false"
					[id]="'video_modal_close_btn'"
					[ariaLabel]="'close' | transloco"
					(click)="modal.dismiss('Cross click')"
				>
					<i class="ri-close-line"></i>
				</app-button>
			</div>
			<div class="modal-body">
				@if (video(); as current) {
					<app-video-poster
						[video]="current"
						[priority]="true"
						[autostart]="true"
					/>
					<a
						class="btn btn-animation btn-sm d-inline-flex mt-3"
						[href]="link()"
						target="_blank"
						rel="noopener"
					>
						<i class="ri-youtube-fill me-2"></i>
						{{ 'watch_on_youtube' | transloco }}
					</a>
				}
			</div>
		</ng-template>
	`,
})
export class VideoModal {
	private readonly modals = inject(NgbModal);
	readonly template = viewChild<TemplateRef<unknown>>('videoModal');
	readonly video = signal<IVideo | null>(null);
	readonly link = computed(() => {
		const current = this.video();
		return current ? watchUrl(current) : '';
	});

	open(video: IVideo): void {
		this.video.set(video);
		this.modals.open(this.template(), { centered: true, size: 'xl', windowClass: 'theme-modal' });
	}
}
