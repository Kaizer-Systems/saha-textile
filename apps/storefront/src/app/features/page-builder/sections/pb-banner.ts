import { Component, computed, input } from '@angular/core';

import { type ResolvedPageSectionView, sectionContainer } from '../page-builder.types';
import { PbPiece } from './pb-piece';

/**
 * A banner arrangement (Q9 A: today's four hero arrangements). Pieces are drawn in source order, Main first, on
 * every size: nothing is reordered by CSS (FX-4). On a phone held upright the side pieces sit next to each other
 * below Main (Q5 A); with "Main only" they are not drawn on phones.
 */
@Component({
	selector: 'app-pb-banner',
	imports: [PbPiece],
	template: `
		@if (section().arrangement === 'hero_full') {
			<div class="home-section-2 home-section-bg overflow-hidden">
				@if (main(); as piece) {
					<app-pb-piece
						[piece]="piece"
						[early]="early()"
						sizes="100vw"
					/>
				}
			</div>
		} @else {
			<div [class]="container()">
				<div class="row g-3 g-xl-4">
					@if (main(); as piece) {
						<div [class]="mainColumn()">
							<app-pb-piece
								[piece]="piece"
								[early]="early()"
								[sizes]="mainSizes()"
							/>
						</div>
					}
					@if (sides().length) {
						<div [class]="sidesColumn()">
							<div class="row g-3 g-xl-4">
								@for (piece of sides(); track piece.name) {
									<div [class]="sideColumn()">
										<app-pb-piece
											[piece]="piece"
											sizes="(min-width: 1200px) 25vw, 50vw"
										/>
									</div>
								}
							</div>
						</div>
					}
				</div>
			</div>
		}
	`,
})
export class PbBanner {
	readonly section = input.required<ResolvedPageSectionView>();
	/** The first section: its first picture is the page's one early picture. */
	readonly early = input(false);

	readonly container = computed(() => sectionContainer(this.section()));
	readonly main = computed(() => this.section().pieces.find((piece) => piece.name === 'main') ?? null);
	readonly sides = computed(() => this.section().pieces.filter((piece) => piece.name !== 'main'));
	private readonly wide = computed(() => this.section().arrangement === 'hero_main_side');
	readonly mainColumn = computed(() => (this.wide() ? 'col-xl-9' : 'col-xl-8'));
	readonly mainSizes = computed(() =>
		this.wide() ? '(min-width: 1200px) 75vw, 100vw' : '(min-width: 1200px) 66vw, 100vw',
	);
	readonly sidesColumn = computed(() => {
		const phones = this.section().phoneSides === 'main_only' ? ' d-none d-md-block' : '';
		return (this.wide() ? 'col-xl-3' : 'col-xl-4') + phones;
	});
	readonly sideColumn = computed(() => (this.sides().length > 1 ? 'col-6 col-xl-12' : 'col-12'));
}
