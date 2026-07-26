import type { Meta, StoryObj } from '@storybook/angular';

import { CartLineConfig } from '../../../storefront/src/app/shared/ui/cart-line-config/cart-line-config';

const meta = {
	title: 'Storefront/Commerce Configuration/Cart Line Summary',
	component: CartLineConfig,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		config: {
			variation_label: 'Emerald / Medium',
			addon_options: [{ group: 'Blouse design', value: 'Heritage', price_delta: 450 }],
			bundle_options: [{ group: 'Petticoat', value: 'Cotton / Medium', price_delta: 250 }],
			bundle_components: [
				{ name: 'Saree', sku: 'ST-SAREE-01', price: 5200 },
				{ name: 'Blouse piece', sku: 'ST-BLOUSE-01', price: 450 },
			],
			measurements: [
				{ label: 'Chest', value: 36, unit: 'in' },
				{ label: 'Waist', value: 30, unit: 'in' },
			],
			base_price: 5200,
			delta_total: 700,
		},
	},
} satisfies Meta<CartLineConfig>;

export default meta;
type Story = StoryObj<CartLineConfig>;

export const ConfiguredSaree: Story = {};

export const PlainLine: Story = {
	args: {
		config: {
			base_price: 5200,
			delta_total: 0,
		},
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Unconfigured cart-line contract</p>
				<app-cart-line-config [config]="config" />
				<p class="storybookStateNote">
					Plain line items intentionally emit no configuration breakdown.
				</p>
			</section>
		`,
	}),
};
