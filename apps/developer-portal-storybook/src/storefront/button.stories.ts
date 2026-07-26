import type { Meta, StoryObj } from '@storybook/angular';

import { Button } from '../../../storefront/src/app/shared/ui/button/button';

const meta = {
	title: 'Storefront/Foundation/Button',
	component: Button,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component: 'The real storefront action button, including its disabled and loader-aware contracts.',
			},
		},
	},
	args: {
		class: 'btn btn-animation justify-content-center',
		id: 'storybook-storefront-action',
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
					Continue to checkout
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
