import type { Meta, StoryObj } from '@storybook/angular';

import { FormFields } from '../../../admin/src/app/shared/ui/form-fields/form-fields';

const meta = {
	title: 'Admin/Forms/Form Field',
	component: FormFields,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	args: {
		label: 'Product title',
		for: 'storybook-product-title',
		required: true,
	},
	render: (args) => ({
		props: args,
		template: `
			<section class="storybookComponentStage storybookFormStage">
				<app-form-fields
					[label]="label"
					[for]="for"
					[required]="required"
				>
					<input
						id="storybook-product-title"
						class="form-control"
						value="Katan Banarasi Saree"
					/>
				</app-form-fields>
			</section>
		`,
	}),
} satisfies Meta<FormFields>;

export default meta;
type Story = StoryObj<FormFields>;

export const RequiredTextInput: Story = {};

export const OptionalField: Story = {
	args: {
		label: 'Internal note',
		required: false,
	},
};
