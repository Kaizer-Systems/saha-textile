import { Component, computed, input } from '@angular/core';

import { type ResolvedPageSectionView, sectionContainer } from '../page-builder.types';
import { PbPiece } from './pb-piece';

/** Two promo banners side by side (today's home promos: wide first, square second). */
@Component({
	selector: 'app-pb-promos',
	imports: [PbPiece],
	template: `
		<div [class]="container()">
			<div class="row g-4">
				@for (piece of section().pieces; track piece.name; let first = $first) {
					<div [class]="first ? 'col-xxl-8 col-xl-12 col-md-7' : 'col-xxl-4 col-xl-12 col-md-5'">
						<app-pb-piece
							[piece]="piece"
							[early]="early() && first"
							[sizes]="
								first
									? '(min-width: 1400px) 66vw, (min-width: 1200px) 100vw, (min-width: 768px) 58vw, 100vw'
									: '(min-width: 1400px) 33vw, (min-width: 1200px) 100vw, (min-width: 768px) 42vw, 100vw'
							"
						/>
					</div>
				}
			</div>
		</div>
	`,
})
export class PbPromos {
	readonly section = input.required<ResolvedPageSectionView>();
	readonly early = input(false);
	readonly container = computed(() => sectionContainer(this.section()));
}
