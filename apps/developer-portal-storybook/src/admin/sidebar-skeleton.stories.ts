import type { Meta, StoryObj } from '@storybook/angular';

import { SidebarMenuSkeleton } from '../../../admin/src/app/shared/ui/skeleton/sidebar-menu-skeleton/sidebar-menu-skeleton';

const meta = {
	title: 'Admin/Loading/Sidebar Menu Skeleton',
	component: SidebarMenuSkeleton,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		loading: true,
	},
} satisfies Meta<SidebarMenuSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
