import type { Meta, StoryObj } from '@storybook/angular';

import { AddonGroup } from '../../../storefront/src/app/shared/ui/product-config/parts/addon-group/addon-group';

import { namedAddonProduct } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Commerce Configuration/Named Add-on',
	component: AddonGroup,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'The real tailoring add-on composition, including conditional measurement validation and running INR total.',
			},
		},
	},
	args: {
		product: namedAddonProduct,
		basePrice: namedAddonProduct.sale_price,
	},
} satisfies Meta<AddonGroup>;

export default meta;
type Story = StoryObj<AddonGroup>;

export const DefaultSelection: Story = {};

export const SavedConfiguration: Story = {
	args: {
		initialSelections: {
			blouse_design: 'design_1',
		},
		initialMeasurements: {
			shoulder: 15,
			chest: 36,
			waist: 30,
			sleeve: 10,
		},
	},
};
