import type { Meta, StoryObj } from '@storybook/angular';

import { PeriodPicker } from '../../../admin/src/app/shared/ui/period-picker/period-picker';

/**
 * The period choice on the admin home page's Revenue and Orders tiles.
 *
 * A small link under the figure opens the preset list. Custom keeps the menu open for a start
 * and an end day, and the tile hears nothing until both are picked.
 */
const meta = {
	title: 'Admin/Forms/Period Picker',
	component: PeriodPicker,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
} satisfies Meta<PeriodPicker>;

export default meta;
type Story = StoryObj<PeriodPicker>;

/** How a tile first shows it, on the last 12 months. */
export const Default: Story = {};
