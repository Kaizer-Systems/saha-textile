import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { NotificationService } from '../../../admin/src/app/data-access/services/notification.service';
import { ExportMenu, type ExportSource } from '../../../admin/src/app/shared/ui/export-menu/export-menu';

/**
 * The Export menu on every admin list and report (brief 25 EX1): CSV, Excel or PDF of what the screen is filtered to,
 * every matching row, with the columns in view. A statement with its own printed layout offers CSV and Excel only.
 */
const sample: ExportSource = {
	fileName: 'credit-notes_2026-11',
	title: 'Credit notes',
	filters: [{ label: 'Period', value: 'This month' }],
	header: ['Number', 'Date', 'Customer', 'Total'],
	rows: [
		['CN/26-27/000007', '2026-11-24', 'Mou Ghosh', 4680],
		['CN/26-27/000006', '2026-11-21', 'Anita Roy', 2340],
	],
	kinds: { 3: 'money' },
	area: 'accounts',
};

const meta = {
	title: 'Admin/Data/Export Menu',
	component: ExportMenu,
	tags: ['autodocs'],
	decorators: [
		applicationConfig({
			providers: [{ provide: NotificationService, useValue: { showError: () => undefined } }],
		}),
	],
	parameters: {
		application: 'admin',
	},
	args: {
		source: () => sample,
		id: 'story_export',
	},
} satisfies Meta<ExportMenu>;

export default meta;
type Story = StoryObj<ExportMenu>;

/** A list: all three formats. */
export const AllFormats: Story = {};

/** A statement whose own layout prints it: CSV and Excel only. */
export const WithoutPdf: Story = {
	args: { formats: ['csv', 'xlsx'] },
};
