import type { Meta, StoryObj } from '@storybook/angular';

import { NoData } from '../../../storefront/src/app/shared/ui/no-data/no-data';

const meta = {
	title: 'Storefront/States/No Data',
	component: NoData,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		class: 'no-data-added',
		text: 'Nothing here yet',
		description: 'Try adjusting the current filters or return to the catalogue.',
	},
} satisfies Meta<NoData>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
