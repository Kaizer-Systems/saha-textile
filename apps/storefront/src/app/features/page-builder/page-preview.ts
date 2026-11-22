import { HttpClient } from '@angular/common/http';
import {
	Component,
	DestroyRef,
	ElementRef,
	PLATFORM_ID,
	ViewEncapsulation,
	afterNextRender,
	computed,
	inject,
} from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { REQUEST } from '@analogjs/router/tokens';
import { TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

import { previewAdminOrigin } from '../../../server/admin-origin';
import { BundlePreview } from './bundle-preview/bundle-preview';
import { PageLayout } from './page-layout';
import type { StorefrontPageLayoutView } from './page-builder.types';
import { linkToBuilder } from './preview-messages';

/** The session cookie the preview middleware sets (server/middleware/preview.ts). */
export const PREVIEW_COOKIE = 'st_preview';

/** A cookie's value from a Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | null {
	for (const part of (header ?? '').split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return decodeURIComponent(value.join('='));
	}
	return null;
}

/** What the server hands the browser: the draft, and the one origin the page may talk to. */
export interface PreviewPageData {
	layout: StorefrontPageLayoutView | null;
	adminOrigin: string | null;
}

/**
 * The builder's preview (Page Builder step 6): a layout's draft drawn by the shop's own section code, at
 * `/{locale}/__preview/{pageType}`. The session cookie can't be read by scripts, so the draft is fetched on the server
 * and reaches the browser in the page's data copy; the browser never asks again (a new draft is a reload). Inside the
 * builder's frame, a click chooses a section there and the builder's choice is outlined here (preview-messages.ts).
 */
@Component({
	selector: 'app-page-preview',
	template: `
		@if (pageType === 'bundle') {
			<app-bundle-preview [adminOrigin]="adminOrigin()" />
		} @else if (sections(); as list) {
			<app-page-layout
				[sections]="list"
				[preview]="true"
			/>
		}
	`,
	// Preview-only: these rules ship with this page's own file, never with the shop's pages.
	styles: `
		app-page-preview [data-pb-id] {
			cursor: pointer;
		}
		app-page-preview [data-pb-id]:hover {
			outline: 2px dashed var(--theme-color);
			outline-offset: -2px;
		}
		app-page-preview [data-pb-id].pb-preview-chosen {
			outline: 3px solid var(--theme-color);
			outline-offset: -3px;
		}
	`,
	encapsulation: ViewEncapsulation.None,
	imports: [PageLayout, BundlePreview],
})
export class PagePreview {
	private readonly http = inject(HttpClient);
	private readonly request = inject(REQUEST, { optional: true }) as { headers?: { cookie?: string } } | null;
	private readonly onServer = isPlatformServer(inject(PLATFORM_ID));
	private readonly locale = inject(TranslocoService).getActiveLang();
	readonly pageType = inject(ActivatedRoute).snapshot.paramMap.get('type') ?? 'home';

	private readonly query = injectQuery(() => ({
		queryKey: ['page-preview', this.pageType, this.locale],
		enabled: this.onServer,
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: async (): Promise<PreviewPageData> => {
			await runtimeConfigReady;
			const adminOrigin = previewAdminOrigin();
			const token = cookieValue(this.request?.headers?.cookie, PREVIEW_COOKIE);
			if (!token) return { layout: null, adminOrigin };
			const layout = await firstValueFrom(
				this.http.get<StorefrontPageLayoutView>(`${runtimeConfig.apiUrl}/storefront/preview/layout`, {
					params: { token, locale: this.locale },
				}),
			).catch(() => null);
			return { layout, adminOrigin };
		},
	}));

	readonly sections = computed(() => this.query.data()?.layout?.sections ?? null);
	readonly adminOrigin = computed(() => this.query.data()?.adminOrigin ?? null);

	constructor() {
		const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
		let unlink: (() => void) | null = null;
		afterNextRender(() => {
			const origin = this.query.data()?.adminOrigin;
			if (origin && window.parent !== window) unlink = linkToBuilder(host, window, origin);
		});
		inject(DestroyRef).onDestroy(() => unlink?.());
	}
}
