import type { Meta, StoryObj } from '@storybook/angular';

import { ProductBoxSkeleton } from '../../../admin/src/app/shared/ui/skeleton/product-box-skeleton/product-box-skeleton';

const meta = {
	title: 'Admin/Loading/Product Box Skeleton',
	component: ProductBoxSkeleton,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
} satisfies Meta<ProductBoxSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
