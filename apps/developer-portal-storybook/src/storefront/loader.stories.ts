import type { Meta, StoryObj } from '@storybook/angular';

import { Loader } from '../../../storefront/src/app/shared/ui/loader/loader';

const meta = {
	title: 'Storefront/Loading/Application Loader',
	component: Loader,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		loaderClass: 'loader-wrapper',
	},
} satisfies Meta<Loader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
