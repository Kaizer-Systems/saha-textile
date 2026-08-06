import type { Meta, StoryObj } from '@storybook/angular';

import { PinPad } from '../../../admin/src/app/shared/ui/pin-pad/pin-pad';

/**
 * The admin PIN keypad.
 *
 * Worth knowing while reading these stories: there is no text field behind the dots. The PIN
 * is entered on the keypad and nowhere else, so no device keyboard — native or third-party,
 * browser or installed PWA — can be summoned for it on any platform. Digits, Backspace and
 * Enter also work from a physical keyboard, and produce the same visual press as a tap.
 */
const meta = {
	title: 'Admin/Forms/PIN Pad',
	component: PinPad,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		length: 6,
		value: '',
	},
} satisfies Meta<PinPad>;

export default meta;
type Story = StoryObj<PinPad>;

/** How an operator first sees it: six empty cells, every key live. */
export const Empty: Story = {};

/** Mid-entry. Filled cells show a dot, never the digit. */
export const PartiallyEntered: Story = {
	args: {
		value: '135',
	},
};

/**
 * Complete. The digit keys go inert at length so a seventh press cannot silently overwrite,
 * while delete and clear stay available to correct a mistake.
 */
export const Complete: Story = {
	args: {
		value: '135790',
	},
};
