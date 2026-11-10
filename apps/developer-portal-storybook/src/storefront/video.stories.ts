import type { Meta, StoryObj } from '@storybook/angular';

import type { IVideo } from '../../../storefront/src/app/data-access/interfaces/video.interface';
import { ShortCard } from '../../../storefront/src/app/shared/ui/video/short-card';
import { ShortsModal } from '../../../storefront/src/app/shared/ui/video/shorts-modal';
import { VideoCard } from '../../../storefront/src/app/shared/ui/video/video-card';
import { VideoModal } from '../../../storefront/src/app/shared/ui/video/video-modal';

/**
 * The shop's YouTube pieces: the video and Short cards used on the Videos page, the home rail
 * and the product page, and the two popups that play them (click-to-load, so nothing from
 * YouTube loads until a shopper asks).
 */
const video: IVideo = {
	videoId: 'dQw4w9WgXcQ',
	title: 'Handloom saree draping, step by step',
	thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
	kind: 'video',
	durationSeconds: 412,
	publishedAt: '2026-10-01T10:00:00.000Z',
};
const shorts: IVideo[] = [
	{ ...video, videoId: 'aqz-KE-bpKQ', title: 'Katan Banarasi in daylight', kind: 'short', durationSeconds: 48 },
	{ ...video, videoId: 'ScMzIvxBSi4', title: 'Jamdani weave close up', kind: 'short', durationSeconds: 37 },
];

const meta = {
	title: 'Storefront/Video/Video Card',
	component: VideoCard,
	tags: ['autodocs'],
	parameters: { application: 'storefront' },
	args: { video, nowPlaying: false },
	render: (args) => ({
		props: args,
		template: `<section class="storybookComponentStage" style="max-width: 360px"><app-video-card [video]="video" [nowPlaying]="nowPlaying" /></section>`,
	}),
} satisfies Meta<VideoCard>;

export default meta;
type Story = StoryObj<VideoCard>;

/** A long video's card: poster, length and title. */
export const Card: Story = {};

/** The card of the video already playing in the page's player. */
export const NowPlaying: Story = { args: { nowPlaying: true } };

/** A Short's tall card. */
export const Short: Story = {
	render: () => ({
		moduleMetadata: { imports: [ShortCard] },
		props: { short: shorts[0] },
		template: `<section class="storybookComponentStage" style="max-width: 220px"><app-short-card [video]="short" /></section>`,
	}),
};

/** The long-video popup: the button opens it as a card click would. */
export const VideoPopup: Story = {
	render: () => ({
		moduleMetadata: { imports: [VideoModal] },
		props: { video },
		template: `<section class="storybookComponentStage"><app-video-modal #popup /><button type="button" class="btn btn-animation" (click)="popup.open(video)">Open the video popup</button></section>`,
	}),
};

/** The Shorts popup, which steps through every Short in the row. */
export const ShortsPopup: Story = {
	render: () => ({
		moduleMetadata: { imports: [ShortsModal] },
		props: { shorts },
		template: `<section class="storybookComponentStage"><app-shorts-modal #popup /><button type="button" class="btn btn-animation" (click)="popup.open(shorts, shorts[0])">Open the Shorts popup</button></section>`,
	}),
};
