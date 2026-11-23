import { Component, input, viewChild } from '@angular/core';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { ProductDetailModal } from '../../../storefront/src/app/shared/ui/modal/product-detail-modal/product-detail-modal';
import type { IProduct } from '../../../storefront/src/app/data-access/interfaces/product.interface';

import { simpleProduct, variationProduct } from '../fixtures/storefront-products';

/** The component holds its pop-up as a template; this opens it the way its caller does. */
@Component({
	selector: 'storybook-product-detail-modal-stage',
	imports: [ProductDetailModal],
	template: `
		<section class="storybookComponentStage">
			<button
				type="button"
				class="btn theme-bg-color text-white"
				(click)="detail().openModal()"
			>
				Open the product pop-up
			</button>
			<app-product-detail-modal [product]="product()" />
		</section>
	`,
})
class ProductDetailModalStage {
	readonly product = input.required<IProduct>();
	readonly detail = viewChild.required(ProductDetailModal);
}

/**
 * The theme's product pop-up: photos, price, variant choices and Add to cart in a modal. Press the
 * button to open it; the cart here is Storybook's own store.
 */
const meta = {
	title: 'Storefront/Popups/Product Detail Modal',
	component: ProductDetailModal,
	tags: ['autodocs'],
	decorators: [moduleMetadata({ imports: [ProductDetailModalStage] })],
	parameters: { application: 'storefront' },
} satisfies Meta<ProductDetailModal>;

export default meta;
type Story = StoryObj<ProductDetailModal>;

/** A simple product. */
export const SimpleProduct: Story = {
	render: () => ({
		props: { product: simpleProduct },
		template: `<storybook-product-detail-modal-stage [product]="product" />`,
	}),
};

/** A product with variants to choose. */
export const WithVariants: Story = {
	render: () => ({
		props: { product: variationProduct },
		template: `<storybook-product-detail-modal-stage [product]="product" />`,
	}),
};
