import type { Meta, StoryObj } from '@storybook/angular';

import { ProductBoxVertical } from '../../../storefront/src/app/shared/ui/product-box/product-box-vertical/product-box-vertical';

import { simpleProduct } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Commerce/Product Card',
	component: ProductBoxVertical,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'The real compact storefront product card with catalogue fixture data and application styles.',
			},
		},
	},
	args: {
		product: simpleProduct,
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage">
				<div style="width: min(100%, 420px)">
					<app-product-box-vertical [product]="product" />
				</div>
			</section>
		`,
	}),
} satisfies Meta<ProductBoxVertical>;

export default meta;
type Story = StoryObj<ProductBoxVertical>;

export const Compact: Story = {};

export const Discounted: Story = {
	args: {
		product: {
			...simpleProduct,
			price: 6400,
			sale_price: 5200,
			discount: 19,
		},
	},
};
