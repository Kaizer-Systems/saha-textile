import { Component, input } from '@angular/core';

import { ImageLink } from '@shared/ui/image-link/image-link';

import { PbSlider } from '../pb-slider/pb-slider';

import type { ResolvedPieceView } from '../page-builder.types';

/** One picture place: a single picture shows plainly with no slider code; two or more make it a slider (B3, B4). */
@Component({
	selector: 'app-pb-piece',
	imports: [ImageLink, PbSlider],
	template: `
		@if (piece().pictures.length > 1) {
			<app-pb-slider
				[piece]="piece()"
				[early]="early()"
				[sizes]="sizes()"
			/>
		} @else if (piece().pictures[0]; as picture) {
			<div [class]="'pb-ink-' + picture.ink + ' pb-backing-' + picture.backing">
				<app-image-link
					[image]="{ resolved: picture }"
					[priority]="early()"
					[sizes]="sizes()"
					[class]="'home-contain rounded-0 p-0'"
				/>
			</div>
		}
	`,
})
export class PbPiece {
	readonly piece = input.required<ResolvedPieceView>();
	readonly early = input(false);
	readonly sizes = input('100vw');
}
