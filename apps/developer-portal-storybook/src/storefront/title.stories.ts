import type { Meta, StoryObj } from '@storybook/angular';

import { Title } from '../../../storefront/src/app/shared/ui/title/title';

const meta = {
	title: 'Storefront/Typography/Section Title',
	component: Title,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		class: 'title',
		style: 'simple',
		title: 'Curated textile stories',
		description: 'A storefront section heading with an optional supporting description.',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookSpotlight">
				<app-title
					[class]="class"
					[style]="style"
					[title]="title"
					[description]="description"
				/>
			</section>
		`,
	}),
} satisfies Meta<Title>;

export default meta;
type Story = StoryObj<Title>;

export const Simple: Story = {};

export const WithDescription: Story = {
	args: {
		style: undefined,
	},
};
