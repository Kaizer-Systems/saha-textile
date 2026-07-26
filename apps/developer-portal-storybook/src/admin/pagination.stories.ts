import type { Meta, StoryObj } from '@storybook/angular';

import { Pagination } from '../../../admin/src/app/shared/ui/pagination/pagination';

const meta = {
	title: 'Admin/Navigation/Pagination',
	component: Pagination,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		total: 93,
		currentPage: 5,
		pageSize: 15,
	},
} satisfies Meta<Pagination>;

export default meta;
type Story = StoryObj<Pagination>;

export const MiddlePage: Story = {};

export const LastPage: Story = {
	args: {
		currentPage: 7,
	},
};
