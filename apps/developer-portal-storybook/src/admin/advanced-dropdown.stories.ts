import type { Meta, StoryObj } from '@storybook/angular';

import { AdvancedDropdown } from '../../../admin/src/app/shared/ui/advanced-dropdown/advanced-dropdown';

const categoryOptions = [
	{
		id: 1,
		name: 'Sarees',
		children: [
			{ id: 11, name: 'Banarasi', children: [] },
			{ id: 12, name: 'Handloom cotton', children: [] },
		],
	},
	{
		id: 2,
		name: 'Dress materials',
		children: [
			{ id: 21, name: 'Silk blends', children: [] },
			{ id: 22, name: 'Cotton sets', children: [] },
		],
	},
];

const meta = {
	title: 'Admin/Forms/Advanced Dropdown',
	component: AdvancedDropdown,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
		docs: {
			description: {
				component: 'The real searchable hierarchical selector used by admin taxonomy forms.',
			},
		},
	},
	args: {
		displayKey: 'name',
		subArrayKey: 'children',
		options: categoryOptions,
		selectedOption: [11],
		position: 'bottom',
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookFormStage">
				<app-advanced-dropdown
					[displayKey]="displayKey"
					[subArrayKey]="subArrayKey"
					[options]="options"
					[selectedOption]="selectedOption"
					[position]="position"
					[selectSingle]="selectSingle"
				/>
			</section>
		`,
	}),
} satisfies Meta<AdvancedDropdown>;

export default meta;
type Story = StoryObj<AdvancedDropdown>;

export const MultipleSelection: Story = {};

export const SingleSelection: Story = {
	args: {
		selectSingle: true,
	},
};
