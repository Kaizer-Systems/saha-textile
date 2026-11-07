import { provideState } from '@ngrx/store';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { cartReducer } from '../../../admin/src/app/core/state/cart/cart.reducer';
import { ProductBox } from '../../../admin/src/app/shared/ui/product-box/product-box';

import { simpleProduct } from '../fixtures/storefront-products';

const meta = {
	title: 'Admin/Commerce/Product Card',
	component: ProductBox,
	tags: ['autodocs'],
	decorators: [
		applicationConfig({
			providers: [provideState('cart', cartReducer)],
		}),
	],
	parameters: {
		application: 'admin',
	},
	args: {
		product: simpleProduct,
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage">
				<div style="width: min(100%, 340px)">
					<app-product-box [product]="product" />
				</div>
			</section>
		`,
	}),
} satisfies Meta<ProductBox>;

export default meta;
type Story = StoryObj<ProductBox>;

export const InStock: Story = {};

export const OutOfStock: Story = {
	args: {
		product: {
			...simpleProduct,
			stock_status: 'out_of_stock',
		},
	},
};
