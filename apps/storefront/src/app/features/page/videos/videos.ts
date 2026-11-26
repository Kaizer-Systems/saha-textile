import { Location, ViewportScroller } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import {
	NgbAccordionBody,
	NgbAccordionButton,
	NgbAccordionCollapse,
	NgbAccordionDirective,
	NgbAccordionHeader,
	NgbAccordionItem,
} from '@ng-bootstrap/ng-bootstrap';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { IVideo } from '@data-access/interfaces/video.interface';
import { injectChannelVideosQuery } from '@data-access/queries/youtube.queries';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { Title } from '@shared/ui/title/title';
import { ShortCard } from '@shared/ui/video/short-card';
import { ShortsModal } from '@shared/ui/video/shorts-modal';
import { VideoCard } from '@shared/ui/video/video-card';
import { isoDuration, posterFor, watchUrl } from '@shared/ui/video/video-links';
import { VideoPoster } from '@shared/ui/video/video-poster';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

type VideosTab = 'videos' | 'shorts';

const VIDEO_JSONLD = 'video-featured';

/**
 * `/videos` (owner, 2026-11-10: brief revision 4). The blog page's frame: breadcrumb, the
 * product tabs as a Videos / Shorts switch, and the blog sidebar for "Up next".
 *
 * Both tabs are in the server-rendered page; the switch only shows one. `?tab=shorts` opens on
 * Shorts and `?v=<id>` on that video; the page's canonical stays plain `/videos`. Everything comes
 * from the API's daily cache; with nothing cached the page says so and stays out of search.
 */
@Component({
	selector: 'app-videos',
	imports: [
		Breadcrumb,
		Title,
		NoData,
		VideoCard,
		VideoPoster,
		ShortCard,
		ShortsModal,
		ShopDatePipe,
		TranslocoModule,
		NgbAccordionDirective,
		NgbAccordionItem,
		NgbAccordionHeader,
		NgbAccordionButton,
		NgbAccordionCollapse,
		NgbAccordionBody,
	],
	templateUrl: './videos.html',
})
export class Videos {
	private readonly seo = inject(LocaleSeo);
	private readonly location = inject(Location);
	private readonly scroller = inject(ViewportScroller);
	private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

	readonly breadcrumb = translatedBreadcrumb('videos', { description: 'videos_meta_description' });
	private readonly channel = injectChannelVideosQuery();

	readonly videos = computed(() => this.channel.data()?.videos ?? []);
	readonly shorts = computed(() => this.channel.data()?.shorts ?? []);
	readonly channelUrl = computed(() => this.channel.data()?.channelUrl ?? 'https://www.youtube.com/@SahaTextile');
	readonly loaded = computed(() => this.channel.isSuccess());
	readonly empty = computed(() => this.loaded() && !this.videos().length && !this.shorts().length);

	readonly tab = signal<VideosTab>(this.query.get('tab') === 'shorts' ? 'shorts' : 'videos');
	private readonly picked = signal<string | null>(this.query.get('v'));

	/** The video in the big player: the one asked for, else the newest. */
	readonly current = computed<IVideo | null>(() => {
		const list = this.videos();
		return list.find((video) => video.videoId === this.picked()) ?? list[0] ?? null;
	});

	/** The next four after the one playing, wrapping round. */
	readonly upNext = computed(() => {
		const list = this.videos();
		const at = list.findIndex((video) => video.videoId === this.current()?.videoId);
		return [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))].slice(0, 4);
	});

	readonly link = watchUrl;
	readonly cardPoster = (video: IVideo) => posterFor(video, 'card');

	constructor() {
		effect(() => {
			if (this.empty()) this.seo.applyDocument({ robots: 'noindex,follow' });
			const video = this.current();
			if (!video) return;
			// Search engines read the featured video from the page itself (no video sitemap).
			this.seo.applyJsonLd(VIDEO_JSONLD, {
				'@context': 'https://schema.org',
				'@type': 'VideoObject',
				name: video.title,
				description: video.title,
				thumbnailUrl: [posterFor(video, 'large')],
				...(video.publishedAt ? { uploadDate: video.publishedAt } : {}),
				...(video.durationSeconds ? { duration: isoDuration(video.durationSeconds) } : {}),
				embedUrl: `https://www.youtube-nocookie.com/embed/${video.videoId}`,
				contentUrl: watchUrl(video),
			});
		});
		// The next page must not inherit this page's video data.
		inject(DestroyRef).onDestroy(() => this.seo.removeJsonLd(VIDEO_JSONLD));
	}

	setTab(tab: VideosTab): void {
		this.tab.set(tab);
		this.replaceQuery({ tab: tab === 'shorts' ? 'shorts' : null });
	}

	pick(video: IVideo, event?: Event): void {
		event?.preventDefault();
		this.picked.set(video.videoId);
		this.replaceQuery({ v: video.videoId });
		this.scroller.scrollToAnchor('videos-switcher');
	}

	/** The address follows the page (shareable) without a navigation. */
	private replaceQuery(change: Record<string, string | null>): void {
		const [path, search = ''] = this.location.path().split('?');
		const params = new URLSearchParams(search);
		for (const [key, value] of Object.entries(change)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		this.location.replaceState(path, params.toString());
	}
}
