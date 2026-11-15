import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import {
	type MediaFileRow,
	MediaLibraryGateway,
	type ShareLinkCreate,
	type ShareLinksResponse,
} from '@core/media-library/media-library.gateway';
import { MEDIA_LIBRARY_KEY } from '@data-access/queries/media-library.queries';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fileKind } from './file-kinds';

/** “Link stops working” (A35B): the lengths the API takes, then a date, then never. */
export const SHARE_EXPIRIES = ['1h', '1d', '7d', '30d', 'date', 'never'] as const;
export type FmShareExpiry = (typeof SHARE_EXPIRIES)[number];

/** A link's address on the shop: `<shop>/s/<code>`; the language comes from the visitor. */
export const shareAddress = (code: string): string => `${runtimeConfig.siteUrl.replace(/\/+$/, '')}/s/${code}`;

/**
 * Share (A35–A35D). A private file gets our own links: anyone or signed-in admins only, a length or
 * a date or never, an optional password; each can get a new end or be stopped. A plain file can be
 * made public for a permanent address (A35C). A photo shows the website's own address and shares its
 * full-size original by link (A35D). A link's code is shown once, right after it is made: only its
 * hash is stored, so the list names links by their last characters.
 */
@Component({
	selector: 'app-fm-share',
	templateUrl: './fm-share.html',
	imports: [DatePipe, TranslocoModule, FileSizePipe, PluralPipe],
})
export class FmShare {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly queries = inject(QueryClient);
	private readonly transloco = inject(TranslocoService);

	/** Set by `start()` right after the popup opens. */
	readonly file = signal<MediaFileRow | null>(null);
	readonly kind = computed(() => {
		const file = this.file();
		return file ? fileKind(file) : null;
	});
	readonly expiries = SHARE_EXPIRIES;

	readonly data = signal<ShareLinksResponse | null>(null);
	readonly error = signal<string | null>(null);
	readonly busy = signal(false);

	readonly who = signal<'anyone' | 'admins'>('anyone');
	readonly expiry = signal<FmShareExpiry>('7d');
	readonly date = signal('');
	readonly askPassword = signal(false);
	readonly password = signal('');
	/** The link just made: the only time its code is known. */
	readonly made = signal<string | null>(null);
	readonly copied = signal<string | null>(null);
	/** The link whose end is being changed, with the choice so far. */
	readonly changing = signal<{ id: string; expiry: FmShareExpiry; date: string } | null>(null);

	readonly isPhoto = computed(() => this.file()?.kind === 'image');
	readonly isPublic = computed(() => this.data()?.visibility === 'public' && !this.isPhoto());
	readonly activeLinks = computed(() => (this.data()?.links ?? []).filter((link) => link.state === 'active').length);

	/** The file to share; its links load straight away. */
	start(file: MediaFileRow): Promise<void> {
		this.file.set(file);
		return this.load();
	}

	async load(): Promise<void> {
		const file = this.file();
		if (!file) return;
		try {
			this.data.set(await lastValueFrom(this.gateway.links(file.id)));
		} catch (error) {
			this.error.set(this.words(error));
		}
	}

	/** A plain file only: public gives it a permanent address; private takes it away (A35C). */
	async setVisibility(visibility: 'public' | 'private'): Promise<void> {
		if (this.busy() || this.data()?.visibility === visibility) return;
		await this.work(async () => {
			await lastValueFrom(this.gateway.setVisibility(this.file()?.id ?? '', visibility));
			await this.load();
			void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		});
	}

	async create(): Promise<void> {
		if (this.expiry() === 'date' && !this.date())
			return this.error.set(this.transloco.translate('fm_share_pick_date'));
		const body: ShareLinkCreate = {
			expiry: this.expiry(),
			who: this.who(),
			...(this.expiry() === 'date' ? { expiresAt: this.endOfDay(this.date()) } : {}),
			...(this.who() === 'anyone' && this.askPassword() && this.password() ? { password: this.password() } : {}),
		} as ShareLinkCreate;
		await this.work(async () => {
			const link = await lastValueFrom(this.gateway.createLink(this.file()?.id ?? '', body));
			this.made.set(link.code ? shareAddress(link.code) : null);
			this.password.set('');
			this.askPassword.set(false);
			await this.load();
		});
	}

	async saveEnd(): Promise<void> {
		const change = this.changing();
		if (!change || (change.expiry === 'date' && !change.date)) return;
		await this.work(async () => {
			await lastValueFrom(
				this.gateway.updateLink(change.id, {
					expiry: change.expiry,
					...(change.expiry === 'date' ? { expiresAt: this.endOfDay(change.date) } : {}),
				}),
			);
			this.changing.set(null);
			await this.load();
		});
	}

	/** Stopping is for good: a stopped link never opens again. */
	async stop(id: string): Promise<void> {
		await this.work(async () => {
			await lastValueFrom(this.gateway.updateLink(id, { stop: true }));
			await this.load();
		});
	}

	async copy(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			this.copied.set(text);
		} catch {
			this.error.set(this.transloco.translate('fm_share_copy_failed'));
		}
	}

	/** “On a date…” means to the end of that day, in the admin's own time. */
	private endOfDay(day: string): string {
		return new Date(`${day}T23:59:59`).toISOString();
	}

	private async work(job: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		this.error.set(null);
		try {
			await job();
		} catch (error) {
			this.error.set(this.words(error));
		} finally {
			this.busy.set(false);
		}
	}

	private words(error: unknown): string {
		return readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed');
	}
}
