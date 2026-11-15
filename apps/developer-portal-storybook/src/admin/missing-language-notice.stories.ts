import type { Meta, StoryObj } from '@storybook/angular';

import { MissingLanguageNotice } from '../../../admin/src/app/shared/ui/missing-language-notice/missing-language-notice';

const meta = {
	title: 'Admin/Feedback/Missing Language Notice',
	component: MissingLanguageNotice,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		code: 'bn',
	},
} satisfies Meta<MissingLanguageNotice>;

export default meta;
type Story = StoryObj<MissingLanguageNotice>;

export const OneLanguageMissing: Story = {};

export const NoFilter: Story = {
	args: {
		code: null,
	},
};
