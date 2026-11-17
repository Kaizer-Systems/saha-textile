import { DecimalPipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

import { TranslocoModule } from '@jsverse/transloco';
import { lastValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

/** The screen sizes the preview offers (brief C1–C6), upright and on their side. */
export const PREVIEW_SIZES = [
	{ key: 'phone', width: 390, height: 844 },
	{ key: 'phone_side', width: 844, height: 390 },
	{ key: 'tablet', width: 820, height: 1180 },
	{ key: 'tablet_side', width: 1180, height: 820 },
	{ key: 'desktop', width: 1440, height: 900 },
	{ key: 'large', width: 2560, height: 1440 },
] as const;
export type PreviewSize = (typeof PREVIEW_SIZES)[number];

/**
 * The middle of the builder (brief C1–C6, Q1 A): the shop's own page at an exact screen size, scaled to fit, so its
 * own rules decide everything (which picture a band gets, the menu, the phone bar). Each load asks for a fresh
 * one-time code (FX-5); after every save the frame loads again with the new draft.
 */
@Component({
	selector: 'app-pb-preview',
	templateUrl: './pb-preview.html',
	imports: [DecimalPipe, TranslocoModule],
})
export class PbPreview {
	private readonly gateway = inject(PageBuilderGateway);
	private readonly sanitizer = inject(DomSanitizer);
	private readonly host = inject(ElementRef<HTMLElement>);
	readonly layoutId = input.required<string>();
	readonly pageType = input.required<string>();
	readonly locale = input.required<string>();
	/** Changes whenever a save lands, so the frame shows the new draft. */
	readonly revision = input<string | null>(null);
	readonly sizes = PREVIEW_SIZES;
	readonly size = signal<PreviewSize>(PREVIEW_SIZES[4]);
	readonly src = signal<SafeResourceUrl | null>(null);
	readonly failed = signal(false);
	readonly paneWidth = signal(800);

	/** The frame drawn at its real size and scaled down to the pane (never up). */
	readonly scale = computed(() => Math.min(1, this.paneWidth() / this.size().width));

	constructor() {
		effect(() => {
			this.revision();
			this.locale();
			this.size();
			untracked(() => void this.load());
		});
		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(([entry]) => this.paneWidth.set(entry?.contentRect.width ?? 800));
			queueMicrotask(() => observer.observe(this.host.nativeElement));
		}
	}

	async load(): Promise<void> {
		try {
			const { code } = await lastValueFrom(this.gateway.previewCode(this.layoutId()));
			const shop = runtimeConfig.siteUrl.replace(/\/$/, '');
			const url = `${shop}/${encodeURIComponent(this.locale())}/__preview/${encodeURIComponent(this.pageType())}?code=${encodeURIComponent(code)}`;
			this.src.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
			this.failed.set(false);
		} catch {
			this.failed.set(true);
		}
	}
}
