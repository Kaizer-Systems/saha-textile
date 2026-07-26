import type { Meta, StoryObj } from '@storybook/angular';

import { SkeletonProductBox } from '../../../storefront/src/app/shared/ui/product-box/skeleton-product-box/skeleton-product-box';

const meta = {
	title: 'Storefront/Loading/Product Skeleton',
	component: SkeletonProductBox,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		style: 'horizontal',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookSpotlight">
				<app-skeleton-product-box [style]="style" />
			</section>
		`,
	}),
} satisfies Meta<SkeletonProductBox>;

export default meta;
type Story = StoryObj<SkeletonProductBox>;

export const Horizontal: Story = {};

export const Vertical: Story = {
	args: {
		style: 'vertical',
	},
};
