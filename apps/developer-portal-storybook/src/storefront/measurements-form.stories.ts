import type { Meta, StoryObj } from '@storybook/angular';

import { MeasurementsForm } from '../../../storefront/src/app/shared/ui/product-config/parts/measurements-form/measurements-form';

import { measurementFields } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Commerce Configuration/Measurements Form',
	component: MeasurementsForm,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
	},
	args: {
		fields: measurementFields,
		title: 'measurements_required',
	},
} satisfies Meta<MeasurementsForm>;

export default meta;
type Story = StoryObj<MeasurementsForm>;

export const Empty: Story = {};

export const SavedMeasurements: Story = {
	args: {
		initialValues: {
			shoulder: 15,
			chest: 36,
			waist: 30,
			sleeve: 10,
		},
	},
};
