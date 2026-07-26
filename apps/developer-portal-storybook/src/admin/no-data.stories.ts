import type { Meta, StoryObj } from '@storybook/angular';

import { NoData } from '../../../admin/src/app/shared/ui/no-data/no-data';

const meta = {
	title: 'Admin/Feedback/Empty State',
	component: NoData,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		class: 'no-data-added',
		image: '/admin-assets/assets/svg/no-product.svg',
		text: 'No records found',
	},
} satisfies Meta<NoData>;

export default meta;
type Story = StoryObj<NoData>;

export const ProductTable: Story = {};
