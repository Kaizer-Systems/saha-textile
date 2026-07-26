import type { Meta, StoryObj } from '@storybook/angular';

import { AttributesInfo } from '../../../storefront/src/app/shared/ui/product-config/parts/attributes-info/attributes-info';

import { semanticAttributes } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Commerce Configuration/Descriptive Attributes',
	component: AttributesInfo,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		attributes: semanticAttributes,
	},
} satisfies Meta<AttributesInfo>;

export default meta;
type Story = StoryObj<AttributesInfo>;

export const ProductFacts: Story = {};

export const Empty: Story = {
	args: {
		attributes: [],
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Empty descriptive-attribute contract</p>
				<app-attributes-info [attributes]="attributes" />
				<p class="storybookStateNote">
					No panel is emitted when a product has no descriptive attributes.
				</p>
			</section>
		`,
	}),
};
