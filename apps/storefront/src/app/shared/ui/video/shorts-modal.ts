import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { IVideo } from '@data-access/interfaces/video.interface';
import { Button } from '@shared/ui/button/button';

import { VideoPoster } from './video-poster';

/**
 * Shorts in the size-chart modal's shell: narrow on a computer, full screen on a phone, with
 * previous and next. When one ends the next in this list plays, so only the shop's own Shorts
 * ever follow (owner S2); the player itself never shows YouTube's suggestions.
 */
@Component({
	selector: 'app-shorts-modal',
	imports: [Button, VideoPoster, TranslocoModule],
	template: `
		<ng-template
			#shortsModal
			let-modal
		>
			<div class="modal-header">
				<h3
					class="fw-semibold fs-6 mb-0"
					lang="en"
				>
					{{ current()?.title }}
				</h3>
				<app-button
					[class]="'btn btn-close'"
					[spinner]="false"
					[id]="'shorts_modal_close_btn'"
					[ariaLabel]="'close' | transloco"
					(click)="modal.dismiss('Cross click')"
				>
					<i class="ri-close-line"></i>
				</app-button>
			</div>
			<div class="modal-body">
				@if (current(); as short) {
					<!-- Keyed on the id, so stepping replaces the player rather than reusing it. -->
					@for (key of [short.videoId]; track key) {
						<app-video-poster
							[video]="short"
							[autostart]="true"
							[priority]="true"
							(ended)="next()"
						/>
					}
					@if (list().length > 1) {
						<div class="d-flex align-items-center mt-3 gap-2">
							<button
								type="button"
								class="btn btn-animation btn-sm"
								[disabled]="index() === 0"
								[attr.aria-label]="'previous_short' | transloco"
								[title]="'previous_short' | transloco"
								(click)="previous()"
							>
								<i class="ri-arrow-left-s-line"></i>
							</button>
							<span class="text-content small">{{ index() + 1 }} / {{ list().length }}</span>
							<button
								type="button"
								class="btn btn-animation btn-sm"
								[disabled]="index() === list().length - 1"
								[attr.aria-label]="'next_short' | transloco"
								[title]="'next_short' | transloco"
								(click)="next()"
							>
								<i class="ri-arrow-right-s-line"></i>
							</button>
						</div>
					}
				}
			</div>
		</ng-template>
	`,
})
export class ShortsModal {
	private readonly modals = inject(NgbModal);
	readonly template = viewChild<TemplateRef<unknown>>('shortsModal');
	readonly list = signal<IVideo[]>([]);
	readonly index = signal(0);
	readonly current = computed(() => this.list()[this.index()] ?? null);

	open(list: IVideo[], start: IVideo): void {
		this.list.set(list);
		this.index.set(
			Math.max(
				0,
				list.findIndex((short) => short.videoId === start.videoId),
			),
		);
		this.modals.open(this.template(), {
			centered: true,
			size: 'sm',
			fullscreen: 'sm',
			windowClass: 'theme-modal',
		});
	}

	next(): void {
		if (this.index() < this.list().length - 1) this.index.update((at) => at + 1);
	}

	previous(): void {
		if (this.index() > 0) this.index.update((at) => at - 1);
	}
}
