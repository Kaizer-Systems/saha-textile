import type { Meta, StoryObj } from '@storybook/angular';

import { ThumbStack } from '../../../storefront/src/app/shared/ui/thumb-stack/thumb-stack';

const photos = [
	'/assets/images/data/product-1.png',
	'/assets/images/data/product-2.png',
	'/assets/images/data/product-3.png',
];

/**
 * A few overlapping photo thumbnails with a "+N" for the rest: an order card's pieces, a set's
 * pieces. It draws at most `max` photos.
 */
const meta = {
	title: 'Storefront/Media/Thumb Stack',
	component: ThumbStack,
	tags: ['autodocs'],
	parameters: { application: 'storefront' },
	args: { images: photos, more: 0, max: 3, size: 'md' },
	render: (args) => ({
		props: args,
		template: `<section class="storybookComponentStage"><app-thumb-stack [images]="images" [more]="more" [max]="max" [size]="size" /></section>`,
	}),
} satisfies Meta<ThumbStack>;

export default meta;
type Story = StoryObj<ThumbStack>;

/** Three pieces. */
export const ThreePhotos: Story = {};

/** More pieces than it draws: the rest as a count. */
export const WithMore: Story = { args: { more: 4 } };

/** The small size, as in a list row. */
export const Small: Story = { args: { size: 'sm' } };
