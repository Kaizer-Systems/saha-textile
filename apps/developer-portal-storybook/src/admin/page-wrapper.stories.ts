import type { Meta, StoryObj } from '@storybook/angular';

import { PageWrapper } from '../../../admin/src/app/layout/page-wrapper/page-wrapper';

const meta = {
	title: 'Admin/Layout/Page Wrapper',
	component: PageWrapper,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		title: 'Product catalogue',
		grid: true,
		gridClass: 'col-12',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookComponentStage--wide">
				<app-page-wrapper
					[title]="title"
					[grid]="grid"
					[gridClass]="gridClass"
				>
					<button button type="button" class="btn btn-theme">Create product</button>
					<p>A deterministic content projection surface for admin feature pages.</p>
				</app-page-wrapper>
			</section>
		`,
	}),
} satisfies Meta<PageWrapper>;

export default meta;
type Story = StoryObj<PageWrapper>;

export const WithPrimaryAction: Story = {};

export const WithoutHeading: Story = {
	args: {
		title: undefined,
	},
};
