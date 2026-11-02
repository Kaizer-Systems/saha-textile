import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

/** Home hero arrangements (`HomeHeroLayout`). */
export type HeroLayout = 'hero_full' | 'hero_main_side' | 'hero_main_stack' | 'hero_center_sides';

/** Slots each layout renders, in reading order (`HERO_LAYOUT_SLOTS`). */
export const HERO_LAYOUT_SLOTS: Record<HeroLayout, string[]> = {
	hero_full: ['main'],
	hero_main_side: ['main', 'side'],
	hero_main_stack: ['main', 'side_top', 'side_bottom'],
	hero_center_sides: ['left', 'main', 'right'],
};

export type Localized = Record<string, string>;

/** `ContentBlockInput` from `@saha-textile/contracts`, as the editor writes it. */
export interface ContentBlockInput {
	ownerType: 'home' | 'global';
	ownerId: null;
	position: 'hero' | 'newsletter_popup';
	slot: string;
	images: { desktop: string; tablet: string | null; phone: string | null };
	containsText: boolean;
	localeImages: Record<string, { desktop: string; tablet: string | null; phone: string | null }>;
	heading: Localized;
	subheading: Localized;
	ctaLabel: Localized;
	link: { href: string; external: boolean } | null;
	alt: Localized;
	status: 'draft' | 'active' | 'archived';
	startsAt: string | null;
	endsAt: string | null;
}

export interface ContentBlock extends ContentBlockInput {
	id: string;
	key: string;
}

/** Banners and the home hero layout (owner log § Media → Banners and content blocks). */
@Injectable({ providedIn: 'root' })
export class ContentBlocksGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}/admin${path}`;
	}

	heroLayout(): Observable<HeroLayout> {
		return this.http
			.get<{ heroLayout: HeroLayout }>(this.url('/settings/home-hero'))
			.pipe(map((body) => body.heroLayout));
	}

	setHeroLayout(heroLayout: HeroLayout): Observable<HeroLayout> {
		return this.http
			.put<{ heroLayout: HeroLayout }>(this.url('/settings/home-hero'), { heroLayout })
			.pipe(map((body) => body.heroLayout));
	}

	list(ownerType: 'home' | 'global'): Observable<ContentBlock[]> {
		return this.http.get<ContentBlock[]>(this.url('/content-blocks'), { params: { ownerType } });
	}

	save(block: ContentBlockInput): Observable<ContentBlock> {
		return this.http.put<ContentBlock>(this.url('/content-blocks'), block);
	}

	remove(key: string): Observable<void> {
		return this.http.delete<void>(this.url(`/content-blocks/${encodeURIComponent(key)}`));
	}
}

/** `POST /admin/youtube/validate` answer. */
export interface YouTubeValidation {
	videoId: string;
	title: string;
	thumbnailUrl: string;
}

@Injectable({ providedIn: 'root' })
export class YouTubeGateway {
	private readonly http = inject(HttpClient);

	validate(input: string): Observable<YouTubeValidation> {
		return this.http.post<YouTubeValidation>(`${runtimeConfig.apiUrl}/admin/youtube/validate`, { input });
	}
}
