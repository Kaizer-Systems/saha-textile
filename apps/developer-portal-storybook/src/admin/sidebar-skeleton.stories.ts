import type { Meta, StoryObj } from '@storybook/angular';

import { SidebarMenuSkeleton } from '../../../admin/src/app/shared/ui/skeleton/sidebar-menu-skeleton/sidebar-menu-skeleton';

const meta = {
	title: 'Admin/Skeletons/Navigation Sidebar',
	component: SidebarMenuSkeleton,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
		docs: {
			description: {
				component:
					'The real admin sidebar placeholder. Its loading input is exposed so the hidden state can also be verified.',
			},
		},
	},
	args: {
		loading: true,
	},
} satisfies Meta<SidebarMenuSkeleton>;

export default meta;
type Story = StoryObj<SidebarMenuSkeleton>;

export const VisiblePlaceholder: Story = {
	name: 'Visible placeholder rows',
};

export const HiddenAfterLoad: Story = {
	name: 'Hidden after loading completes',
	args: {
		loading: false,
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Resolved navigation state</p>
				<app-sidebar-menu-skeleton [loading]="loading" />
				<p class="storybookStateNote">
					The placeholder correctly withdraws after navigation data resolves.
				</p>
			</section>
		`,
	}),
};
