import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, InjectionToken, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { intlLocale } from '@core/i18n/locale';
import { ShareLinkService, type ShareOpenAnswer } from '@data-access/services/share-link.service';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';
import { fileSizeLabel } from '@shared/util/file-size';

/** The page's states, named as in the approved brief (S1–S8). */
export type ShareView = 'waiting' | 'opening' | 'password' | 'too_many' | 'staff' | 'expired' | 'downloading';

/** Sends this tab to an address: the file's five-minute Spaces address (S7, S8). */
export const OPEN_ADDRESS = new InjectionToken<(url: string) => void>('OPEN_ADDRESS', {
	providedIn: 'root',
	factory: () => (url: string) => location.assign(url),
});

/** “Opening the file…” only for a slow answer: a quick one never flashes it (no-flicker rule). */
export const OPENING_DELAY_MS = 300;
/** Still on this page this long after sending the browser to the file: it was saved, not shown. */
export const DOWNLOAD_SETTLE_MS = 1500;

/**
 * The shop's `/s/{code}` page (media step 1.4): opens a Media share link. Built from the sign-in
 * page's card and the not-found page, so it carries no styles of its own.
 *
 * A link that opens sends the browser to a five-minute Spaces address. Files the browser can show
 * replace this page in the same tab (S7). Anything else downloads and leaves this page open, which
 * then says the download started and offers “click here to download it” (S8). Nothing runs on
 * the server: the check needs this browser's cookies, and the hand-over is the browser's own.
 */
@Component({
	selector: 'app-share-link',
	templateUrl: './share-link.html',
	imports: [Breadcrumb, Button, FormsModule, RouterLink, TranslocoModule],
})
export class ShareLink {
	private readonly shares = inject(ShareLinkService);
	private readonly transloco = inject(TranslocoService);
	private readonly openAddress = inject(OPEN_ADDRESS);
	private readonly route = inject(ActivatedRoute);
	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly timers: ReturnType<typeof setTimeout>[] = [];
	private left = false;

	readonly view = signal<ShareView>('waiting');
	readonly wrong = signal(false);
	readonly busy = signal(false);
	readonly file = signal<{ name: string; bytes: number } | null>(null);
	/** “18.6 MB” in the shopper's language, for S8. */
	readonly fileSize = computed(() => {
		const file = this.file();
		return file ? fileSizeLabel(file.bytes, intlLocale(this.transloco.getActiveLang())) : '';
	});
	password = '';
	/** Kept for “click here to download it” on a password link; never stored anywhere. */
	private acceptedPassword: string | null = null;

	readonly breadcrumb = translatedBreadcrumb('shared_file');

	private readonly code = this.route.snapshot.paramMap.get('code') ?? '';

	constructor() {
		inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
		if (!this.browser) return;
		// A page that is being left for the file's viewer must not switch to “download started”.
		addEventListener('pagehide', () => (this.left = true), { once: true });
		void this.check();
	}

	/** S2 → S7/S8: the password the person typed. */
	async submit(): Promise<void> {
		if (this.busy() || !this.password) return;
		this.busy.set(true);
		const answer = await this.shares.openWithPassword(this.code, this.password).catch(() => null);
		this.busy.set(false);
		if (answer?.state === 'open') this.acceptedPassword = this.password;
		this.show(answer);
	}

	/** S8's “click here to download it”: a fresh five-minute address, then the same hand-over. */
	async downloadAgain(): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		const answer = await (
			this.acceptedPassword
				? this.shares.openWithPassword(this.code, this.acceptedPassword)
				: this.shares.check(this.code)
		).catch(() => null);
		this.busy.set(false);
		this.show(answer);
	}

	private async check(): Promise<void> {
		this.later(OPENING_DELAY_MS, () => {
			if (this.view() === 'waiting') this.view.set('opening');
		});
		this.show(await this.shares.check(this.code).catch(() => null));
	}

	private show(answer: ShareOpenAnswer | null): void {
		switch (answer?.state) {
			case 'open':
				this.file.set({ name: answer.fileName, bytes: answer.bytes });
				this.handOver(answer.url);
				return;
			case 'password':
				this.wrong.set(!!answer.wrong);
				this.view.set('password');
				return;
			case 'too_many':
				this.view.set(this.view() === 'password' || this.view() === 'too_many' ? 'too_many' : 'expired');
				return;
			case 'admins_only':
				this.view.set('staff');
				return;
			default:
				this.view.set('expired');
		}
	}

	/** Sends the browser to the file. If this page is still here a moment later, it was a download. */
	private handOver(url: string): void {
		if (this.view() !== 'downloading') this.view.set('opening');
		this.openAddress(url);
		this.later(DOWNLOAD_SETTLE_MS, () => {
			if (!this.left) this.view.set('downloading');
		});
	}

	private later(ms: number, run: () => void): void {
		this.timers.push(setTimeout(run, ms));
	}
}
