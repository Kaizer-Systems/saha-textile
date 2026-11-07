import type { Meta, StoryObj } from '@storybook/angular';

import { LanguageSwitch } from '../../../admin/src/app/shared/ui/language-switch/language-switch';

const meta = {
	title: 'Admin/Forms/Language Switch',
	component: LanguageSwitch,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		locales: ['en', 'fr'],
		active: 'en',
		gaps: {},
	},
} satisfies Meta<LanguageSwitch>;

export default meta;
type Story = StoryObj<LanguageSwitch>;

export const AllDone: Story = {};

export const WorkLeft: Story = {
	args: {
		gaps: {
			fr: [
				{ key: 'name', label: 'name' },
				{ key: 'value:color:red', label: 'gap_value', name: 'Red' },
			],
		},
	},
};
