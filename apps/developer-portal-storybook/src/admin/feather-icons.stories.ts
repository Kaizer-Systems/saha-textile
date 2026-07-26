import type { Meta, StoryObj } from '@storybook/angular';

import { FeatherIcons } from '../../../admin/src/app/shared/ui/feather-icons/feather-icons';

const meta = {
	title: 'Admin/Foundation/Feather Icon',
	component: FeatherIcons,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		icon: 'settings',
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

export const Settings: Story = {};

export const Users: Story = {
	args: {
		icon: 'users',
	},
};
