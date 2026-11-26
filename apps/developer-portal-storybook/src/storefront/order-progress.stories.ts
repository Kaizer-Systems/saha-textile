import type { Meta, StoryObj } from '@storybook/angular';

import { OrderProgress } from '../../../storefront/src/app/shared/ui/order-progress/order-progress';

/**
 * The order progress track on My orders and the order page: the theme's tracking steps, filled up to
 * the order's status. Packed counts as Processing; a cancelled order stops where it was.
 */
const meta = {
	title: 'Storefront/Account/Order Progress',
	component: OrderProgress,
	tags: ['autodocs'],
	parameters: { application: 'storefront' },
	args: { status: 'shipped', label: 'Shipped' },
	render: (args) => ({
		props: args,
		template: `<section class="storybookComponentStage" style="max-width: 560px"><app-order-progress [status]="status" [label]="label" /></section>`,
	}),
} satisfies Meta<OrderProgress>;

export default meta;
type Story = StoryObj<OrderProgress>;

/** Just placed. */
export const Placed: Story = { args: { status: 'placed', label: 'Placed' } };

/** On its way. */
export const Shipped: Story = {};

/** Arrived: every step filled. */
export const Delivered: Story = { args: { status: 'delivered', label: 'Delivered' } };

/** Cancelled: the track stops and changes colour. */
export const Cancelled: Story = { args: { status: 'cancelled', label: 'Cancelled' } };
