import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Editor, NgxEditorModule, type Toolbar, toHTML } from 'ngx-editor';
import { type Subscription, firstValueFrom } from 'rxjs';

import { INBOX_KEY, MailboxGateway } from '@core/mailboxes/mailbox.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { EDITOR_TOOLBAR, frameDocument } from './inbox-drafts';
import {
	type FilterForm,
	dayEnd,
	dayStart,
	emptyFilterForm,
	filterActions,
	filterForm,
	filterMatch,
	filterWrite,
	istDay,
} from './mailbox-settings-form';

import type { InboxLabel, MailboxFilter, MailboxVacation } from '@saha-textile/contracts';

const statusOf = (error: unknown): number => (error instanceof HttpErrorResponse ? error.status : 0);

/** Why a settings change failed, by the API's status, as a translation key. */
const SAVE_FAILED: Readonly<Record<number, string>> = {
	400: 'inbox_filter_need',
	403: 'inbox_filter_forwarding',
	404: 'inbox_filter_gone',
	409: 'inbox_settings_reconnect',
};

/**
 * A mailbox's Gmail settings (G1), inside the Inbox for people with the mailbox's Settings right:
 * filters, the vacation reply and the main address's signature, read live from Gmail. Built from
 * the theme's tabs, form fields, switches and checkboxes, the Inbox's frame for a signature with
 * pictures, and the compose box's editor for one without.
 */
@Component({
	selector: 'app-mailbox-settings',
	templateUrl: './mailbox-settings.html',
	styleUrls: ['./inbox.scss'],
	imports: [TranslocoModule, NgxEditorModule],
})
export class MailboxSettingsPanel {
	private readonly gateway = inject(MailboxGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly sanitizer = inject(DomSanitizer);

	readonly mailboxId = input.required<string>();
	readonly address = input.required<string>();
	readonly labels = input<readonly InboxLabel[]>([]);

	readonly tab = signal<'filters' | 'vacation' | 'signature'>('filters');
	readonly problem = signal<string | null>(null);
	readonly busy = signal(false);
	readonly filterMatch = filterMatch;
	readonly istDay = istDay;

	private readonly query = injectQuery(() => {
		const mailboxId = this.mailboxId();
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'settings'],
			queryFn: () => firstValueFrom(this.gateway.mailboxSettings(mailboxId)),
			enabled: Boolean(mailboxId),
			retry: 1,
		};
	});
	readonly settings = computed(() => this.query.data() ?? null);
	readonly loading = computed(() => this.query.isPending());
	/** Why the settings could not be read: reconnect, no right, or Gmail not answering. */
	readonly failure = computed(() => {
		if (!this.query.isError() || this.query.data()) return null;
		const status = statusOf(this.query.error());
		if (status === 409) return 'inbox_settings_reconnect';
		if (status === 403) return 'inbox_settings_no_right';
		return 'inbox_gmail_unavailable';
	});
	readonly userLabels = computed(() => this.labels().filter((label) => label.kind === 'label'));
	private readonly labelNames = computed(() => new Map(this.labels().map((label) => [label.id, label.name])));
	readonly domain = computed(() => this.address().split('@')[1] ?? '');

	// ── Filters ───────────────────────────────────────────────────────────────────

	readonly filterEdit = signal<FilterForm | null>(null);
	readonly filterToDelete = signal<MailboxFilter | null>(null);

	actionsOf(filter: MailboxFilter) {
		return filterActions(filter, (id) => this.labelNames().get(id) ?? null);
	}

	startFilter(filter: MailboxFilter | null) {
		this.problem.set(null);
		this.filterToDelete.set(null);
		this.filterEdit.set(filter ? filterForm(filter) : emptyFilterForm());
	}

	editFilter<K extends keyof FilterForm>(field: K, value: FilterForm[K]) {
		const form = this.filterEdit();
		if (form) this.filterEdit.set({ ...form, [field]: value });
	}

	async saveFilter() {
		const form = this.filterEdit();
		const write = form ? filterWrite(form) : null;
		if (!write) {
			this.problem.set('inbox_filter_need');
			return;
		}
		if (await this.run(() => firstValueFrom(this.gateway.addFilter(this.mailboxId(), write)))) {
			this.filterEdit.set(null);
		}
	}

	async deleteFilter(filter: MailboxFilter) {
		if (await this.run(() => firstValueFrom(this.gateway.deleteFilter(this.mailboxId(), filter.id)))) {
			this.filterToDelete.set(null);
		}
	}

	// ── Vacation reply ────────────────────────────────────────────────────────────

	/** The vacation reply being changed; it follows Gmail's whenever the settings are read again. */
	readonly vacation = linkedSignal<MailboxVacation | null>(() => this.settings()?.vacation ?? null);

	editVacation<K extends keyof MailboxVacation>(field: K, value: MailboxVacation[K]) {
		const vacation = this.vacation();
		if (vacation) this.vacation.set({ ...vacation, [field]: value });
	}

	setDay(field: 'startTime' | 'endTime', day: string) {
		this.editVacation(field, field === 'startTime' ? dayStart(day) : dayEnd(day));
	}

	async saveVacation() {
		const vacation = this.vacation();
		if (!vacation) return;
		if (vacation.enabled && !vacation.message.trim()) {
			this.problem.set('inbox_vacation_need_message');
			return;
		}
		if (vacation.startTime && vacation.endTime && vacation.endTime < vacation.startTime) {
			this.problem.set('inbox_vacation_end_before_start');
			return;
		}
		await this.run(() => firstValueFrom(this.gateway.saveVacation(this.mailboxId(), vacation)));
	}

	// ── Signature ─────────────────────────────────────────────────────────────────

	readonly editor = signal<Editor | null>(null);
	readonly editorToolbar = EDITOR_TOOLBAR as Toolbar;
	private readonly signatureHtml = signal('');
	private editorWatch: Subscription | null = null;
	/** A signature with pictures, shown as it is in the Inbox's sandboxed frame. */
	readonly signaturePreview = computed<SafeHtml | null>(() => {
		const signature = this.settings()?.signature;
		return signature && !signature.editable && signature.html
			? this.sanitizer.bypassSecurityTrustHtml(frameDocument(signature.html, true))
			: null;
	});

	async saveSignature() {
		await this.run(() => firstValueFrom(this.gateway.saveSignature(this.mailboxId(), this.signatureHtml())));
	}

	fitFrame(event: Event) {
		const frame = event.target as HTMLIFrameElement;
		const height = frame.contentDocument?.body?.offsetHeight;
		if (height) frame.style.height = `${height}px`;
	}

	constructor() {
		// The signature editor holds what Gmail has whenever the settings are read.
		effect(() => {
			const signature = this.settings()?.signature;
			untracked(() => {
				this.stopEditor();
				if (!signature?.editable || typeof document === 'undefined') return;
				const editor = new Editor();
				editor.setContent(signature.html || '<p></p>');
				this.signatureHtml.set(signature.html);
				this.editorWatch = editor.valueChanges.subscribe((doc) => this.signatureHtml.set(toHTML(doc)));
				this.editor.set(editor);
			});
		});
		inject(DestroyRef).onDestroy(() => this.stopEditor());
	}

	private stopEditor() {
		this.editorWatch?.unsubscribe();
		this.editorWatch = null;
		this.editor()?.destroy();
		this.editor.set(null);
	}

	/** One change at a time: says "Saved to Gmail" and reads the settings again, or says why not. */
	private async run(change: () => Promise<unknown>): Promise<boolean> {
		if (this.busy()) return false;
		this.busy.set(true);
		this.problem.set(null);
		try {
			await change();
		} catch (error) {
			this.problem.set(SAVE_FAILED[statusOf(error)] ?? 'inbox_settings_failed');
			if (statusOf(error) === 404) void this.query.refetch();
			return false;
		} finally {
			this.busy.set(false);
		}
		this.notifier.showSuccess(this.transloco.translate('inbox_settings_saved'));
		// Everything is read again, the mailbox list too: the compose box shows a new signature.
		await this.queryClient.invalidateQueries({ queryKey: INBOX_KEY });
		return true;
	}
}
