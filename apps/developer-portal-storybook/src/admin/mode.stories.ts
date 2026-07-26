import type { Meta, StoryObj } from '@storybook/angular';

import { Mode } from '../../../admin/src/app/layout/header/widgets/mode/mode';

const meta = {
	title: 'Admin/Layout/Theme Mode Control',
	component: Mode,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	render: () => ({
		template: `
			<section class="storybookComponentStage">
				<div class="storybookIconSpecimen">
					<app-mode />
					<span>Portal mode toggle</span>
				</div>
			</section>
		`,
	}),
} satisfies Meta<Mode>;

export default meta;
type Story = StoryObj<Mode>;

export const Default: Story = {};
