import type { Meta, StoryObj } from '@storybook/angular';

import { SetSummary } from '../../../storefront/src/app/shared/ui/product-config/parts/set-summary/set-summary';

import { weddingSet } from '../fixtures/storefront-sets';

/**
 * A set's summary in the product page's right column: its pieces as chosen, the extras ticked, the
 * set price and what it saves against buying the pieces separately (never a negative saving).
 */
const meta = {
	title: 'Storefront/Commerce Configuration/Set Summary',
	component: SetSummary,
	tags: ['autodocs'],
	parameters: { application: 'storefront' },
	args: {
		bundle: weddingSet,
		name: 'Wedding Set',
		photo: '/assets/images/data/product-1.png',
		quantity: 1,
		picks: { saree: ['peacock-banarasi'], blouse: ['gold-brocade'] },
		extras: [],
	},
	render: (args) => ({
		props: args,
		template: `<section class="storybookComponentStage storybookCommerceStage" style="max-width: 420px"><app-set-summary [bundle]="bundle" [name]="name" [photo]="photo" [quantity]="quantity" [picks]="picks" [extras]="extras" /></section>`,
	}),
} satisfies Meta<SetSummary>;

export default meta;
type Story = StoryObj<SetSummary>;

/** The silk saree picked: the set saves against the pieces bought separately. */
export const SilkSaree: Story = {};

/** The cotton saree picked, with the free petticoat ticked. */
export const CottonWithPetticoat: Story = {
	args: { picks: { saree: ['ivory-tant'], blouse: ['gold-brocade'] }, extras: ['cream-petticoat'] },
};
