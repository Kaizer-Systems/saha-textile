import { DatePipe } from '@angular/common';
import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { ToastrService } from '@damjantonkli/ngx-toastr';
import { lastValueFrom } from 'rxjs';

import {
	type EmailPictureQuery,
	type EmailPictureRow,
	MediaLibraryGateway,
} from '@core/media-library/media-library.gateway';
import { MEDIA_LIBRARY_KEY, injectEmailPicturesQuery } from '@data-access/queries/media-library.queries';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

/** The “last sent in an email” filter (A50), widest first. */
export const EMAIL_SENT_OPTIONS: readonly EmailPictureQuery['sent'][] = ['all', 'never', 'over_1y', 'over_2y'];

/** DigitalOcean bills extra storage per GiB a month (R4-7). */
const PRICE_PER_GIB_MONTH = 0.02;

/** “Frees 7.8 MB · less than $0.01 a month” (A51): what deleting saves on the bill, in US dollars a month. */
export function monthlyCost(bytes: number): number {
	return (bytes / 1024 ** 3) * PRICE_PER_GIB_MONTH;
}

/**
 * Clean up › Email pictures (Media brief R6-1, A50, A51; media step 3f): the email pictures whose photo was deleted or
 * replaced, kept for good so order emails already sent keep their pictures. Nothing here is deleted by itself; an
 * admin can delete chosen ones after a warning with a box to tick. The other Clean up lists come with media step 5.
 */
@Component({
	selector: 'app-fm-clean-up',
	templateUrl: './fm-clean-up.html',
	imports: [DatePipe, FileSizePipe, PluralPipe, TranslocoModule],
})
export class FmCleanUp {
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly queries = inject(QueryClient);
	private readonly modals = inject(NgbModal);
	private readonly toastr = inject(ToastrService);
	private readonly transloco = inject(TranslocoService);
	private readonly confirmTemplate = viewChild<TemplateRef<unknown>>('fmEmailDelete');

	readonly sentOptions = EMAIL_SENT_OPTIONS;
	readonly sent = signal<EmailPictureQuery['sent']>('all');
	readonly pages = signal<string[]>([]);
	private readonly after = computed(() => this.pages().at(-1) ?? null);
	readonly list = injectEmailPicturesQuery(() => ({
		sent: this.sent(),
		...(this.after() ? { after: this.after() as string } : {}),
	}));
	/** Rows shown so far: earlier pages are kept as more are asked for. */
	readonly shown = signal<EmailPictureRow[]>([]);
	readonly rows = computed(() => {
		const page = this.list.data()?.rows ?? [];
		const seen = new Set(this.shown().map((row) => row.key));
		return [...this.shown(), ...page.filter((row) => !seen.has(row.key))];
	});
	readonly picked = signal<ReadonlySet<string>>(new Set());
	readonly chosen = computed(() => this.rows().filter((row) => this.picked().has(row.key)));
	readonly chosenBytes = computed(() => this.chosen().reduce((sum, row) => sum + row.bytes, 0));
	readonly allPicked = computed(
		() => this.rows().length > 0 && this.rows().every((row) => this.picked().has(row.key)),
	);
	/** A51's box: the red button stays off until it is ticked. */
	readonly understood = signal(false);
	readonly deleting = signal(false);

	setSent(value: string): void {
		if (!EMAIL_SENT_OPTIONS.includes(value as EmailPictureQuery['sent'])) return;
		this.sent.set(value as EmailPictureQuery['sent']);
		this.pages.set([]);
		this.shown.set([]);
		this.picked.set(new Set());
	}

	showMore(): void {
		const next = this.list.data()?.next;
		if (!next) return;
		this.shown.set(this.rows());
		this.pages.update((pages) => [...pages, next]);
	}

	toggle(key: string): void {
		this.picked.update((keys) => {
			const next = new Set(keys);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	toggleAll(): void {
		this.picked.set(this.allPicked() ? new Set() : new Set(this.rows().map((row) => row.key)));
	}

	clear(): void {
		this.picked.set(new Set());
	}

	/** Order emails that show the chosen pictures; 0 until order emails are sent (Chunk G). */
	readonly chosenEmails = computed(() => this.chosen().reduce((sum, row) => sum + row.sentCount, 0));
	/** The earliest and latest “last sent” among the chosen, or null when none was ever sent. */
	readonly chosenSent = computed(() => {
		const dates = this.chosen()
			.map((row) => row.lastSentAt)
			.filter((at): at is string => !!at)
			.sort();
		return dates.length ? { from: dates[0] as string, to: dates[dates.length - 1] as string } : null;
	});
	readonly chosenCost = computed(() => monthlyCost(this.chosenBytes()));

	/** A51: asks with the warning and the box to tick, then deletes for good. */
	async deleteChosen(): Promise<void> {
		const template = this.confirmTemplate();
		const keys = this.chosen().map((row) => row.key);
		if (!template || !keys.length) return;
		this.understood.set(false);
		const answer = await this.modals
			.open(template, { centered: true, windowClass: 'theme-modal text-center', ariaLabelledBy: 'fm_ed_title' })
			.result.catch(() => null);
		if (answer !== 'yes') return;
		this.deleting.set(true);
		try {
			const done = await lastValueFrom(this.gateway.deleteEmailPictures(keys));
			this.toastr.success(this.transloco.translate('fm_email_deleted', { count: done.deleted }));
			this.picked.set(new Set());
			this.pages.set([]);
			this.shown.set([]);
			await this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
		} catch {
			this.toastr.error(this.transloco.translate('fm_action_failed'));
		} finally {
			this.deleting.set(false);
		}
	}
}
