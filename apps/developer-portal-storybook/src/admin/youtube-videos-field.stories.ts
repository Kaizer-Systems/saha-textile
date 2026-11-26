import { FormControl } from '@angular/forms';

import { of, throwError } from 'rxjs';

import type { ProductVideo } from '@saha-textile/contracts';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { YouTubeGateway } from '../../../admin/src/app/core/media/content-blocks.gateway';
import { YouTubeVideosField } from '../../../admin/src/app/shared/ui/youtube-videos-field/youtube-videos-field';

/**
 * The product form's videos: up to five YouTube videos or Shorts, each checked against YouTube
 * when pasted, with up, down and remove. Real component; the gateway is a stand-in, so
 * Storybook never calls the API. A pasted link containing "private" is refused the way the API
 * refuses a private or non-embeddable video.
 */
const gatewayBoundary = {
	validate: (input: string) =>
		input.includes('private')
			? throwError(() => ({ error: { message: 'This video is private or cannot be embedded.' } }))
			: of({
					videoId: 'aqz-KE-bpKQ',
					title: 'Katan Banarasi in daylight',
					thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg',
					kind: 'short',
					durationSeconds: 48,
				}),
};

const saved: ProductVideo[] = [
	{
		videoId: 'dQw4w9WgXcQ',
		title: 'Handloom saree draping, step by step',
		thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
		kind: 'video',
		durationSeconds: 412,
		unavailableSince: null,
	},
	{
		videoId: 'ScMzIvxBSi4',
		title: 'Jamdani weave close up',
		thumbnailUrl: 'https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg',
		kind: 'short',
		durationSeconds: 37,
		unavailableSince: '2026-11-03T04:30:00.000Z',
	},
];

const meta = {
	title: 'Admin/Forms/YouTube Videos Field',
	component: YouTubeVideosField,
	tags: ['autodocs'],
	decorators: [moduleMetadata({ providers: [{ provide: YouTubeGateway, useValue: gatewayBoundary }] })],
	parameters: { application: 'admin' },
} satisfies Meta<YouTubeVideosField>;

export default meta;
type Story = StoryObj<YouTubeVideosField>;

/** A product without videos: the paste box and Validate. */
export const Empty: Story = {
	args: { control: new FormControl<ProductVideo[]>([], { nonNullable: true }) },
};

/** Two videos, one of which YouTube no longer plays (the weekly check marked it). */
export const WithVideos: Story = {
	args: { control: new FormControl<ProductVideo[]>(saved, { nonNullable: true }) },
};
