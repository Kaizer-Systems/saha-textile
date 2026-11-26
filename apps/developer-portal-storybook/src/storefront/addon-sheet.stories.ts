import { Component, input, viewChild, type AfterViewInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { AddonSheet } from '../../../storefront/src/app/shared/ui/product-config/parts/addon-sheet/addon-sheet';

import { namedAddonProduct } from '../fixtures/storefront-products';

/** Opens the sheet the way the buy bar does: with the page's product and its choices so far. */
@Component({
	selector: 'storybook-addon-sheet-stage',
	imports: [AddonSheet],
	template: `
		<section
			class="storybookComponentStage theme-modal"
			style="max-width: 560px"
		>
			<div class="modal-content"><app-addon-sheet /></div>
		</section>
	`,
})
class AddonSheetStage implements AfterViewInit {
	readonly mode = input<'designs' | 'all'>('all');
	private readonly sheet = viewChild.required(AddonSheet);

	ngAfterViewInit(): void {
		queueMicrotask(() =>
			this.sheet().start({
				product: namedAddonProduct,
				basePrice: namedAddonProduct.sale_price,
				selections: {},
				measurements: {},
				mode: this.mode(),
			}),
		);
	}
}

/**
 * The buy bar's sheet: the page's own add-on part inside the shop's pop-up (a sheet from the bottom
 * on phones). It starts from the page's choices and hands them back on Save. The active-modal handle
 * is a stand-in, so Save and close do nothing here.
 */
const meta = {
	title: 'Storefront/Commerce Configuration/Add-on Sheet',
	component: AddonSheet,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [AddonSheetStage],
			providers: [{ provide: NgbActiveModal, useValue: { close: () => undefined, dismiss: () => undefined } }],
		}),
	],
	parameters: { application: 'storefront' },
} satisfies Meta<AddonSheet>;

export default meta;
type Story = StoryObj<AddonSheet>;

/** Edit add-on: the whole add-on form and Save. */
export const EditAddon: Story = {
	render: () => ({ template: `<storybook-addon-sheet-stage mode="all" />` }),
};

/** The pencil: designs, the measurement row and the total, then Done. */
export const Designs: Story = {
	render: () => ({ template: `<storybook-addon-sheet-stage mode="designs" />` }),
};
