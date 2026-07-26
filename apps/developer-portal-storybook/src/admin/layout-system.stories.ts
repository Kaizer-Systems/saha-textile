import { Content } from '../../../admin/src/app/layout/content/content';
import { Footer } from '../../../admin/src/app/layout/footer/footer';
import { Full } from '../../../admin/src/app/layout/full/full';
import { Header } from '../../../admin/src/app/layout/header/header';
import { Languages } from '../../../admin/src/app/layout/header/widgets/languages/languages';
import { Mode } from '../../../admin/src/app/layout/header/widgets/mode/mode';
import { Notification } from '../../../admin/src/app/layout/header/widgets/notification/notification';
import { Profile } from '../../../admin/src/app/layout/header/widgets/profile/profile';
import { Search } from '../../../admin/src/app/layout/header/widgets/search/search';
import { Sidebar } from '../../../admin/src/app/layout/sidebar/sidebar';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

const meta = {
	title: 'Admin/Layout/Application Chrome',
	component: Header,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [Content, Footer, Full, Header, Languages, Mode, Notification, Profile, Search, Sidebar],
		}),
	],
	parameters: {
		application: 'admin',
		docs: {
			description: {
				component:
					'The real Admin navigation chrome, its leaf utilities, responsive sidebar, footer, and router-bearing layout shells.',
			},
		},
	},
} satisfies Meta<Header>;

export default meta;
type Story = StoryObj<Header>;

export const HeaderBar: Story = {};

export const HeaderUtilities: Story = {
	render: () => ({
		template: `
			<section class="storybookComponentStage storybookComponentStage--wide">
				<app-search />
				<app-languages />
				<app-notification />
				<app-mode />
				<app-profile />
			</section>
		`,
	}),
};

export const SidebarNavigation: Story = {
	render: () => ({
		template:
			'<section style="min-height: 720px; width: 320px; background: #111"><app-sidebar class="sidebar-wrapper" /></section>',
	}),
};

export const FooterBar: Story = {
	render: () => ({ template: '<app-footer />' }),
};

export const AuthenticatedContentShell: Story = {
	render: () => ({ template: '<app-content />' }),
};

export const PublicRouteShell: Story = {
	render: () => ({
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Public route composition boundary</p>
				<p class="storybookStateNote">
					The empty router outlet is ready to receive the selected authentication page.
				</p>
				<app-full />
			</section>
		`,
	}),
};
