import type { Meta, StoryObj } from '@storybook/angular';

import { Loader } from '../../../storefront/src/app/shared/ui/loader/loader';

const meta = {
	title: 'Storefront/Feedback/Full-page Loader',
	component: Loader,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'This real component is a persistent loading specimen: it has no completion input and intentionally stays visible. Storybook is not waiting for data.',
			},
		},
	},
	args: {
		loaderClass: 'loader-wrapper',
	},
} satisfies Meta<Loader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PersistentState: Story = {
	name: 'Persistent state (intentional)',
	parameters: {
		docs: {
			description: {
				story: 'The spinner never resolves by design. Application containers remove this component when their own loading state finishes.',
			},
		},
	},
};
