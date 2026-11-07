import type { Meta, StoryObj } from '@storybook/angular';

import { ProductBoxSkeleton } from '../../../admin/src/app/shared/ui/skeleton/product-box-skeleton/product-box-skeleton';

const meta = {
	title: 'Admin/Skeletons/Product Card',
	component: ProductBoxSkeleton,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
		docs: {
			description: {
				component:
					'The real admin product-card skeleton. It intentionally remains a placeholder because it represents the loading state itself.',
			},
		},
	},
} satisfies Meta<ProductBoxSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlaceholderGrid: Story = {
	name: 'Product grid placeholder',
};
