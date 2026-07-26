import type { Meta, StoryObj } from '@storybook/angular';

import { Pagination } from '../../../storefront/src/app/shared/ui/pagination/pagination';

const meta = {
	title: 'Storefront/Navigation/Pagination',
	component: Pagination,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		total: 72,
		currentPage: 4,
		pageSize: 12,
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage">
				<app-pagination
					[total]="total"
					[currentPage]="currentPage"
					[pageSize]="pageSize"
				/>
			</section>
		`,
	}),
} satisfies Meta<Pagination>;

export default meta;
type Story = StoryObj<Pagination>;

export const MiddlePage: Story = {};

export const FirstPage: Story = {
	args: {
		currentPage: 1,
	},
};
