import type { Meta, StoryObj } from '@storybook/angular';

import { LookPreview } from '../../../admin/src/app/shared/ui/look-preview/look-preview';

const values = [
	{
		label: 'Boat neck',
		subLabel: 'Classic',
		picture: '/admin-assets/assets/images/product.png',
		hex: null,
		price: 0,
	},
	{ label: 'Sweetheart', subLabel: null, picture: null, hex: '#c7518a', price: 150 },
	{ label: 'High neck', subLabel: null, picture: null, hex: '#2445a8', price: 250 },
];

/**
 * Admin's live sketch of an option look, under the look choice: how the shop will show the values on
 * hand, the first drawn as chosen. Plain admin colours; it follows the look as soon as another is picked.
 */
const meta = {
	title: 'Admin/Catalogue/Look Preview',
	component: LookPreview,
	tags: ['autodocs'],
	parameters: { application: 'admin' },
	args: { look: 'radio_bar', values, note: '', help: '', compact: false },
	render: (args) => ({
		props: args,
		template: `<section class="storybookComponentStage" style="max-width: 520px"><app-look-preview [look]="look" [values]="values" [note]="note" [help]="help" [compact]="compact" /></section>`,
	}),
} satisfies Meta<LookPreview>;

export default meta;
type Story = StoryObj<LookPreview>;

/** Radio bar: names with their prices. */
export const RadioBar: Story = {};

/** Colour swatches: colour only, the name on hover. */
export const ColourSwatch: Story = { args: { look: 'color_swatch' } };

/** Picture tiles: the swatch picture, name and price; a value with no picture draws the grey placeholder. */
export const PictureTile: Story = { args: { look: 'image_tile' } };

/** Compact, as inside the swatch cut pop-up. */
export const Compact: Story = { args: { look: 'image_swatch', compact: true } };
