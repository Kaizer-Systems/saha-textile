import type { Meta, StoryObj } from '@storybook/angular';

import { SkeletonProductBox } from '../../../storefront/src/app/shared/ui/product-box/skeleton-product-box/skeleton-product-box';

const meta = {
	title: 'Storefront/Skeletons/Product Card',
	component: SkeletonProductBox,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'Static product-card placeholders shown while catalogue data is loading. These are intentional visual states, not unresolved Storybook requests.',
			},
		},
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

export const Horizontal: Story = {
	name: 'Horizontal card placeholder',
};

export const Vertical: Story = {
	name: 'Vertical card placeholder',
	args: {
		style: 'vertical',
	},
};
