import type { Meta, StoryObj } from '@storybook/angular';

import { Button } from '../../../admin/src/app/shared/ui/button/button';

const meta = {
	title: 'Admin/Foundation/Button',
	component: Button,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		class: 'btn btn-theme',
		id: 'storybook-admin-action',
		spinner: false,
		type: 'button',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookSpotlight">
				<app-button
					[class]="class"
					[id]="id"
					[spinner]="spinner"
					[type]="type"
					[disabled]="disabled"
				>
					Save product
				</app-button>
			</section>
		`,
	}),
} satisfies Meta<Button>;

export default meta;
type Story = StoryObj<Button>;

export const Primary: Story = {};

export const Disabled: Story = {
	args: {
		disabled: true,
	},
};
