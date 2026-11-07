import type { Meta, StoryObj } from '@storybook/angular';

import { Loader } from '../../../admin/src/app/layout/loader/loader';

const meta = {
	title: 'Admin/Feedback/Loader',
	component: Loader,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
		docs: {
			description: {
				component: 'The real admin loading indicator in its full-page and contained forms.',
			},
		},
	},
} satisfies Meta<Loader>;

export default meta;
type Story = StoryObj<Loader>;

export const FullPage: Story = {};

export const Contained: Story = {
	args: {
		loaderClass: 'custom-loader-wrapper',
	},
};
