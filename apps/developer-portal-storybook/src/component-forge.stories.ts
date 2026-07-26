import type { Meta, StoryObj } from '@storybook/angular';

const meta = {
	title: 'Shared/Overview/Component Forge',
	tags: ['autodocs'],
	parameters: {
		application: 'shared',
	},
	render: () => ({
		template: `
			<section class="storybookForgeOverview storybookSpotlight">
				<div class="storybookForgeOverview__heading">
					<p>One Angular renderer · three isolated contexts</p>
					<h1>The project’s living building blocks.</h1>
					<p>
						Use the top-level systems to inspect real components with the correct
						application stylesheet. Shared tokens, motion, focus, and canvas behavior
						remain unified across every preview.
					</p>
				</div>
				<div class="storybookForgeOverview__systems">
					<article class="storybookForgeOverview__system storybookSpotlight" data-system="storefront">
						<span>Storefront</span>
						<strong>Customer-facing states</strong>
						<p>Commerce UI, responsive storefront primitives, loading and empty states.</p>
					</article>
					<article class="storybookForgeOverview__system storybookSpotlight" data-system="admin">
						<span>Admin</span>
						<strong>Operational controls</strong>
						<p>Back-office forms, system feedback, navigation and data-management states.</p>
					</article>
					<article class="storybookForgeOverview__system storybookSpotlight" data-system="shared">
						<span>Shared</span>
						<strong>Theme contract</strong>
						<p>Portable portal tokens, interaction grammar, accessibility and motion rules.</p>
					</article>
				</div>
			</section>
		`,
	}),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const LaunchBay: Story = {};
