import { DatePipe } from '@angular/common';
import { Component, TemplateRef, computed, effect, inject, output, signal, untracked, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { ToastrService } from '@damjantonkli/ngx-toastr';
import { lastValueFrom } from 'rxjs';

import {
	type EmailPictureQuery,
	type EmailPictureRow,
	type MediaCleanUpQuery,
	type MediaCleanUpRow,
	type MediaFileRow,
	MediaLibraryGateway,
} from '@core/media-library/media-library.gateway';
import {
	MEDIA_LIBRARY_KEY,
	injectCleanUpQuery,
	injectEmailPicturesQuery,
} from '@data-access/queries/media-library.queries';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fileKind, fileTypeLabel } from './file-kinds';

/** The “last sent in an email” filter (A50), widest first. */
export const EMAIL_SENT_OPTIONS: readonly EmailPictureQuery['sent'][] = ['all', 'never', 'over_1y', 'over_2y'];

/** Clean up's tabs (A44): the three file lists, then Email pictures (A50). */
export type CleanTab = MediaCleanUpQuery['list'] | 'email';
export const CLEAN_TABS: readonly CleanTab[] = ['unused', 'largest', 'duplicates', 'email'];

/** DigitalOcean bills extra storage per GiB a month (R4-7). */
const PRICE_PER_GIB_MONTH = 0.02;

/** “Frees 7.8 MB · less than $0.01 a month” (A51): what deleting saves on the bill, in US dollars a month. */
export function monthlyCost(bytes: number): number {
	return (bytes / 1024 ** 3) * PRICE_PER_GIB_MONTH;
}

/**
 * Clean up › Email pictures (Media brief R6-1, A50, A51; media step 3f): the email pictures whose photo was deleted or
 * replaced, kept for good so order emails already sent keep their pictures. Nothing here is deleted by itself; an
 * admin can delete chosen ones after a warning with a box to tick. The other lists (A44, media step 5): files not
 * used for 90 days, the largest, and later copies of the same file; chosen ones go to Trash through the Media
 * page's own Trash (the in-use check and Undo), never deleted from here.
 */
@Component({
	selector: 'app-fm-clean-up',
	templateUrl: './fm-clean-up.html',
	imports: [DatePipe, FileSizePipe, PluralPipe, TranslocoModule],
})
export class FmCleanUp {
	/** A44: the chosen files, for the Media page's Trash. */
	readonly trash = output<MediaFileRow[]>();
	/** Which list shows; Email pictures is A50. */
	readonly tab = signal<CleanTab>('unused');
	readonly filePage = signal(1);
	readonly clean = injectCleanUpQuery(() => ({
		list: this.tab() === 'email' ? 'unused' : (this.tab() as MediaCleanUpQuery['list']),
		page: this.filePage(),
	}));
	/** Rows shown so far in a file list: earlier pages are kept as more are asked for. */
	readonly shownFiles = signal<MediaCleanUpRow[]>([]);
	readonly fileRows = computed(() => {
		const page = this.tab() === 'email' ? [] : (this.clean.data()?.rows ?? []);
		const seen = new Set(this.shownFiles().map((row) => row.file.id));
		return [...this.shownFiles(), ...page.filter((row) => !seen.has(row.file.id))];
	});
	readonly filePicked = signal<ReadonlySet<string>>(new Set());
	/**
	 * Ticks stay when the tab changes (accounts brief H, owner-approved 2026-11-23): each ticked row is
	 * remembered, so the bar counts every tick on every tab and Move to Trash takes them all.
	 */
	private readonly seenFiles = new Map<string, MediaCleanUpRow>();
	private readonly seenVersion = signal(0);
	/** Remembers each row as it is shown, so ticks on another tab keep their rows. */
	private readonly rememberRows = effect(() => {
		for (const row of this.fileRows()) this.seenFiles.set(row.file.id, row);
		untracked(() => this.seenVersion.update((n) => n + 1));
	});
	readonly chosenFiles = computed(() => {
		this.seenVersion();
		for (const row of this.fileRows()) this.seenFiles.set(row.file.id, row);
		return [...this.filePicked()].flatMap((id) => this.seenFiles.get(id) ?? []);
	});
	readonly chosenFileBytes = computed(() => this.chosenFiles().reduce((sum, row) => sum + row.file.bytes, 0));
	readonly allFilesPicked = computed(
		() => this.fileRows().length > 0 && this.fileRows().every((row) => this.filePicked().has(row.file.id)),
	);
	readonly moreFiles = computed(() => {
		const data = this.clean.data();
		return !!data && data.list === this.tab() && this.fileRows().length < data.total;
	});
	readonly kind = fileKind;
	readonly tabs = CLEAN_TABS;
	readonly typeLabel = fileTypeLabel;

	setTab(tab: CleanTab): void {
		this.tab.set(tab);
		this.filePage.set(1);
		this.shownFiles.set([]);
	}

	moreFileRows(): void {
		this.shownFiles.set(this.fileRows());
		this.filePage.update((page) => page + 1);
	}

	toggleFile(id: string): void {
		const next = new Set(this.filePicked());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.filePicked.set(next);
	}

	clearFiles(): void {
		this.filePicked.set(new Set());
	}

	/** Ticks or unticks this tab's rows; ticks on other tabs stay. */
	toggleAllFiles(): void {
		const ids = this.fileRows().map((row) => row.file.id);
		const next = new Set(this.filePicked());
		if (this.allFilesPicked()) for (const id of ids) next.delete(id);
		else for (const id of ids) next.add(id);
		this.filePicked.set(next);
	}

	/** Move to Trash: the Media page asks, keeps Undo for 8 seconds, and the lists are read again. */
	trashChosenFiles(): void {
		const files = this.chosenFiles().map((row) => row.file);
		if (!files.length) return;
		this.trash.emit(files);
		this.filePicked.set(new Set());
		this.shownFiles.set([]);
		this.filePage.set(1);
	}

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
	/** Ticks stay when "Sent" changes (accounts brief H): each ticked picture is remembered. */
	private readonly seenRows = new Map<string, EmailPictureRow>();
	private readonly seenEmailVersion = signal(0);
	private readonly rememberEmailRows = effect(() => {
		for (const row of this.rows()) this.seenRows.set(row.key, row);
		untracked(() => this.seenEmailVersion.update((n) => n + 1));
	});
	readonly chosen = computed(() => {
		this.seenEmailVersion();
		for (const row of this.rows()) this.seenRows.set(row.key, row);
		return [...this.picked()].flatMap((key) => this.seenRows.get(key) ?? []);
	});
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

	/** Ticks or unticks the pictures shown; ticks made under another "Sent" choice stay. */
	toggleAll(): void {
		const keys = this.rows().map((row) => row.key);
		const next = new Set(this.picked());
		if (this.allPicked()) for (const key of keys) next.delete(key);
		else for (const key of keys) next.add(key);
		this.picked.set(next);
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
