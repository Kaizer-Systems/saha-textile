import type { Meta, StoryObj } from '@storybook/angular';

import { Breadcrumb } from '../../../storefront/src/app/shared/ui/breadcrumb/breadcrumb';

const meta = {
	title: 'Storefront/Navigation/Breadcrumb',
	component: Breadcrumb,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		breadcrumb: {
			title: 'Banarasi silk sarees',
			items: [
				{ label: 'Collections', url: '/collections' },
				{ label: 'Banarasi silk sarees', active: true },
			],
		},
	},
} satisfies Meta<Breadcrumb>;

export default meta;
type Story = StoryObj<Breadcrumb>;

export const CollectionTrail: Story = {};
