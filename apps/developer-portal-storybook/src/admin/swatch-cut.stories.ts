import { Component, viewChild, type AfterViewInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';

import { MediaLibraryGateway } from '../../../admin/src/app/core/media-library/media-library.gateway';
import { SwatchCut } from '../../../admin/src/app/shared/ui/swatch-cut/swatch-cut';

/** A product photo as the media library describes it for cutting: its address and size. */
const photo = {
	photoId: 'photo-1',
	name: 'Peacock Banarasi, pallu',
	url: '/admin-assets/assets/images/sign-in-saree-basket-rtl-1280.webp',
	width: 1280,
	height: 853,
	cutId: null,
	region: null,
};

/** Opens the pop-up the way a swatch field does: for one value and its photo. */
@Component({
	selector: 'storybook-swatch-cut-stage',
	imports: [SwatchCut],
	template: `
		<section
			class="storybookComponentStage theme-modal"
			style="max-width: 760px"
		>
			<div class="modal-content"><app-swatch-cut /></div>
		</section>
	`,
})
class SwatchCutStage implements AfterViewInit {
	private readonly cut = viewChild.required(SwatchCut);

	ngAfterViewInit(): void {
		queueMicrotask(() => void this.cut().start({ pictureId: photo.photoId, valueName: 'Peacock', price: 150 }));
	}
}

/**
 * The swatch cut pop-up: a square of a product photo becomes a value's swatch, with the live look
 * previews beside it and "This will look soft" when the square is too small. Here the photo comes from
 * the admin's own images and Save cut goes nowhere.
 */
const meta = {
	title: 'Admin/Media/Swatch Cut',
	component: SwatchCut,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [SwatchCutStage],
			providers: [
				{ provide: NgbActiveModal, useValue: { close: () => undefined, dismiss: () => undefined } },
				{
					provide: MediaLibraryGateway,
					useValue: {
						cutSource: () => of(photo),
						cut: () => of({ id: 'cut-1', versionId: 'v1', px: 640, soft: false }),
					},
				},
			],
		}),
	],
	parameters: { application: 'admin' },
	render: () => ({ template: `<storybook-swatch-cut-stage />` }),
} satisfies Meta<SwatchCut>;

export default meta;
type Story = StoryObj<SwatchCut>;

/** A first cut from a photo: the square starts in the middle at 3×. */
export const FirstCut: Story = {};
