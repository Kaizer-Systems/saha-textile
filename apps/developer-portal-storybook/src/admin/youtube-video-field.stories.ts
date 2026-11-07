import { FormControl } from '@angular/forms';

import { of, throwError } from 'rxjs';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { YouTubeGateway } from '../../../admin/src/app/core/media/content-blocks.gateway';
import { YouTubeVideoField } from '../../../admin/src/app/shared/ui/youtube-video-field/youtube-video-field';

/**
 * The product form's PDP video field (owner log § Media → Video and YouTube).
 *
 * Real component; the gateway is replaced so Storybook never calls the API. Any input that
 * contains "private" answers the way the API refuses a private or non-embeddable video; anything
 * else matches a public video, and the Validate button becomes its title.
 */
const gatewayBoundary = {
	validate: (input: string) =>
		input.includes('private')
			? throwError(() => ({ error: { message: 'This video is private or cannot be embedded.' } }))
			: of({
					videoId: 'dQw4w9WgXcQ',
					title: 'Handloom saree draping, step by step',
					thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
				}),
};

const meta = {
	title: 'Admin/Forms/YouTube Video Field',
	component: YouTubeVideoField,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			providers: [{ provide: YouTubeGateway, useValue: gatewayBoundary }],
		}),
	],
	parameters: {
		application: 'admin',
	},
} satisfies Meta<YouTubeVideoField>;

export default meta;
type Story = StoryObj<YouTubeVideoField>;

/** A product without a video: empty text, Validate idle. */
export const Empty: Story = {
	args: { control: new FormControl<string | null>(null) },
};

/** A product that already has a video: the stored id is re-validated on load and its title shown. */
export const Validated: Story = {
	args: { control: new FormControl<string | null>('dQw4w9WgXcQ') },
};

/** A stored id the API now refuses: the error shows and the control blocks the form. */
export const Refused: Story = {
	args: { control: new FormControl<string | null>('private-video') },
};
