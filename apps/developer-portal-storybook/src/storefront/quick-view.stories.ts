import { Component, inject, input, viewChild, type AfterViewInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { QuickView } from '../../../storefront/src/app/shared/ui/modal/quick-view/quick-view';

import { variationProduct } from '../fixtures/storefront-products';

/**
 * Opens the quick view the way a product card does. With `loaded`, the product is already in the
 * page's query cache (as after a visit to its page); without it, the card's name shows while it loads.
 */
@Component({
	selector: 'storybook-quick-view-stage',
	imports: [QuickView],
	template: `
		<section
			class="storybookComponentStage st-quick-view"
			style="max-width: 1100px"
		>
			<div class="modal-content"><app-quick-view /></div>
		</section>
	`,
})
class QuickViewStage implements AfterViewInit {
	readonly loaded = input(false);
	private readonly view = viewChild.required(QuickView);
	private readonly cache = inject(QueryClient);

	ngAfterViewInit(): void {
		queueMicrotask(() => {
			const slug = this.loaded() ? variationProduct.slug : `${variationProduct.slug}-loading`;
			if (this.loaded()) this.cache.setQueryData(['catalog', 'product', slug, ''], variationProduct);
			this.view().card.set(variationProduct);
			if (this.loaded()) this.view().slug.set(slug);
		});
	}
}

/**
 * Quick view, built from the product page's own parts: its gallery and its buy box side by side on
 * laptops and tablets, centred and scrolling inside on phones. The active-modal handle is a stand-in.
 */
const meta = {
	title: 'Storefront/Popups/Quick View',
	component: QuickView,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [QuickViewStage],
			providers: [{ provide: NgbActiveModal, useValue: { close: () => undefined, dismiss: () => undefined } }],
		}),
	],
	parameters: { application: 'storefront' },
} satisfies Meta<QuickView>;

export default meta;
type Story = StoryObj<QuickView>;

/** The product is already known: gallery and buy box. */
export const Loaded: Story = {
	render: () => ({ template: `<storybook-quick-view-stage [loaded]="true" />` }),
};

/** Still loading: the pop-up keeps its shape and shows the card's name. */
export const Loading: Story = {
	render: () => ({ template: `<storybook-quick-view-stage />` }),
};
