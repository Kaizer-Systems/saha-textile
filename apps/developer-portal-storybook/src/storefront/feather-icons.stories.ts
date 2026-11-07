import type { Meta, StoryObj } from '@storybook/angular';

import { FeatherIcons } from '../../../storefront/src/app/shared/ui/feather-icons/feather-icons';

const meta = {
	title: 'Storefront/Foundation/Feather Icon',
	component: FeatherIcons,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		icon: 'shopping-bag',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage">
				<div class="storybookIconSpecimen">
					<app-feather-icons [icon]="icon" />
					<span>{{ icon }}</span>
				</div>
			</section>
		`,
	}),
} satisfies Meta<FeatherIcons>;

export default meta;
type Story = StoryObj<FeatherIcons>;

export const ShoppingBag: Story = {};

export const Heart: Story = {
	args: {
		icon: 'heart',
	},
};
