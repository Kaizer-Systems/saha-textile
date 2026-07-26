import type { Meta, StoryObj } from '@storybook/angular';

import { OptionSwatch } from '../../../storefront/src/app/shared/ui/product-config/parts/option-swatch/option-swatch';

import { optionTerms } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Commerce Configuration/Option Swatch',
	component: OptionSwatch,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'One real option selector exercised across the display styles supported by add-on and bundle configuration.',
			},
		},
	},
	args: {
		label: 'Blouse design',
		terms: optionTerms,
		required: true,
		selected: 'heritage',
		displayStyle: 'rectangle',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookCommerceStage">
				<app-option-swatch
					[label]="label"
					[terms]="terms"
					[required]="required"
					[selected]="selected"
					[displayStyle]="displayStyle"
				/>
			</section>
		`,
	}),
} satisfies Meta<OptionSwatch>;

export default meta;
type Story = StoryObj<OptionSwatch>;

export const Rectangle: Story = {};

export const RadioBar: Story = {
	args: {
		displayStyle: 'radio_bar',
	},
};

export const Dropdown: Story = {
	args: {
		displayStyle: 'dropdown',
	},
};

export const Colour: Story = {
	args: {
		displayStyle: 'color',
		terms: [
			{ code: 'indigo', label: 'Indigo', price_delta: 0, image: '#2445a8' },
			{ code: 'vermillion', label: 'Vermillion', price_delta: 150, image: '#d94832' },
			{ code: 'lotus', label: 'Lotus', price_delta: 150, image: '#c7518a' },
		],
		selected: 'vermillion',
	},
};
