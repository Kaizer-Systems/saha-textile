import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { INBOX_KEY, INBOX_REFRESH_MS, MailboxGateway, injectInboxSummaryQuery } from '@core/mailboxes/mailbox.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import {
	type Draft,
	type DraftMode,
	draftFor,
	draftProblem,
	frameDocument,
	primaryAddress,
	sendRequest,
} from './inbox-drafts';

import type {
	InboxAttachment,
	InboxFolder,
	InboxMessage,
	InboxModifyRequest,
	InboxThreadSummary,
} from '@saha-textile/contracts';

export const FOLDERS: readonly { id: InboxFolder; icon: string }[] = [
	{ id: 'inbox', icon: 'ri-inbox-line' },
	{ id: 'sent', icon: 'ri-send-plane-line' },
	{ id: 'all', icon: 'ri-mail-line' },
	{ id: 'spam', icon: 'ri-spam-2-line' },
	{ id: 'trash', icon: 'ri-delete-bin-line' },
];

/** What each conversation button says once it has worked. */
const DONE: Readonly<Record<InboxModifyRequest['action'], string>> = {
	mark_read: 'inbox_marked_read',
	mark_unread: 'inbox_marked_unread',
	archive: 'inbox_archived',
	move_to_inbox: 'inbox_moved_to_inbox',
	trash: 'inbox_trashed',
	untrash: 'inbox_untrashed',
};

/** The display name in `Ananya <ananya@example.com>`, or the address when there is none. */
export function senderName(from: string): string {
	const name = from
		.replace(/<[^>]*>/, '')
		.replace(/"/g, '')
		.trim();
	return name || from.replace(/[<>]/g, '').trim();
}

/**
 * The Inbox (`mailbox.use`): the Gmail mailboxes this admin user was given in Settings › Mailboxes.
 * Folders, the conversation list and the reading pane sit side by side on a wide screen and one at
 * a time on a phone. Gmail stays the only copy of every message; the API reads it live.
 */
@Component({
	selector: 'app-inbox',
	templateUrl: './inbox.html',
	styleUrls: ['./inbox.scss'],
	imports: [PageWrapper, TranslocoModule, Select2, DatePipe, FormFields],
})
export class Inbox {
	private readonly gateway = inject(MailboxGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly sanitizer = inject(DomSanitizer);

	readonly folders = FOLDERS;
	readonly senderName = senderName;

	private readonly summary = injectInboxSummaryQuery();
	readonly loadingMailboxes = computed(() => this.summary.isPending());
	readonly mailboxes = computed(() => this.summary.data() ?? []);
	private readonly chosenId = signal<string | null>(null);
	readonly mailbox = computed(
		() => this.mailboxes().find((entry) => entry.mailboxId === this.chosenId()) ?? this.mailboxes()[0] ?? null,
	);
	readonly connected = computed(() => this.mailbox()?.status === 'connected');
	readonly canSend = computed(() => Boolean(this.mailbox()?.canSend) && this.connected());
	readonly mailboxChoices = computed<Select2Data>(() =>
		this.mailboxes().map((entry) => ({
			value: entry.mailboxId,
			label: entry.unread ? `${entry.address} (${entry.unread})` : entry.address,
		})),
	);
	readonly fromChoices = computed<Select2Data>(() =>
		(this.mailbox()?.sendAs ?? []).map((entry) => ({
			value: entry.address,
			label: entry.isPrimary ? entry.address : `${entry.address} (${this.transloco.translate('inbox_alias')})`,
		})),
	);

	readonly folder = signal<InboxFolder>('inbox');
	readonly searchText = signal('');
	private readonly q = signal('');
	/** Page tokens of the pages before this one, so Newer can step back. */
	private readonly pages = signal<string[]>([]);
	readonly firstPage = computed(() => this.pages().length === 0);

	private readonly threadsQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		const folder = this.folder();
		const q = this.q();
		const pageToken = this.pages().at(-1);
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'threads', folder, q, pageToken ?? ''],
			queryFn: () => firstValueFrom(this.gateway.threads(mailboxId, folder, q || undefined, pageToken)),
			enabled: Boolean(mailboxId) && this.connected(),
			refetchInterval: INBOX_REFRESH_MS,
		};
	});
	readonly threads = computed(() => this.threadsQuery.data()?.threads ?? []);
	readonly nextPage = computed(() => this.threadsQuery.data()?.nextPageToken ?? null);
	readonly loadingThreads = computed(() => this.connected() && this.threadsQuery.isPending());
	readonly gmailDown = computed(() => this.threadsQuery.isError());

	readonly openId = signal<string | null>(null);
	private readonly threadQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		const threadId = this.openId() ?? '';
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'thread', threadId],
			queryFn: () => firstValueFrom(this.gateway.thread(mailboxId, threadId)),
			enabled: Boolean(mailboxId && threadId),
		};
	});
	readonly thread = computed(() => (this.openId() ? (this.threadQuery.data() ?? null) : null));
	readonly loadingThread = computed(() => Boolean(this.openId()) && this.threadQuery.isPending());

	/** Messages whose pictures someone asked to see. */
	private readonly pictures = signal<ReadonlySet<string>>(new Set());
	/** Each message's frame document, built once per message and picture choice so frames do not reload. */
	readonly frames = computed(() => {
		const shown = this.pictures();
		return new Map<string, SafeHtml>(
			(this.thread()?.messages ?? []).map((message) => [
				message.id,
				// The API cleaned this HTML, and it renders inside a sandbox with no scripts and its
				// own content policy, so Angular's own cleaning (which would strip its styles) is skipped.
				this.sanitizer.bypassSecurityTrustHtml(frameDocument(message.html, shown.has(message.id))),
			]),
		);
	});

	readonly draft = signal<Draft | null>(null);
	readonly files = signal<File[]>([]);
	readonly sending = signal(false);
	/** Phones show one column at a time: the list, or the open conversation or draft. */
	readonly reading = computed(() => Boolean(this.openId() || this.draft()));

	chooseMailbox(event: Select2UpdateEvent) {
		const value = typeof event.value === 'string' ? event.value : null;
		if (!value || value === this.mailbox()?.mailboxId) return;
		this.chosenId.set(value);
		this.restart();
	}

	chooseFolder(folder: InboxFolder) {
		this.folder.set(folder);
		this.restart();
	}

	search() {
		this.q.set(this.searchText().trim());
		this.restart();
	}

	older() {
		const token = this.nextPage();
		if (token) this.pages.update((pages) => [...pages, token]);
	}

	newer() {
		this.pages.update((pages) => pages.slice(0, -1));
	}

	/** Opens a conversation, and marks it read the way Gmail does. */
	async open(row: InboxThreadSummary) {
		this.draft.set(null);
		this.openId.set(row.id);
		const mailboxId = this.mailbox()?.mailboxId;
		if (!row.unread || !mailboxId) return;
		await firstValueFrom(this.gateway.modify(mailboxId, row.id, 'mark_read'));
		await this.reload();
	}

	back() {
		this.openId.set(null);
		this.draft.set(null);
	}

	/** Archive, trash, restore or mark unread. Anything that moves it out of view closes it. */
	async act(action: InboxModifyRequest['action']) {
		const mailboxId = this.mailbox()?.mailboxId;
		const threadId = this.openId();
		if (!mailboxId || !threadId) return;
		await firstValueFrom(this.gateway.modify(mailboxId, threadId, action));
		this.notifier.showSuccess(this.transloco.translate(DONE[action]));
		if (action !== 'mark_read') this.back();
		await this.reload();
	}

	picturesShown(message: InboxMessage): boolean {
		return this.pictures().has(message.id);
	}

	showPictures(message: InboxMessage) {
		this.pictures.update((shown) => new Set([...shown, message.id]));
	}

	/**
	 * Fits a message's frame to its content, so the conversation scrolls as one page. It measures the
	 * body, not the page: the page is never shorter than the frame's own window (150 px by default),
	 * which left short messages with a tall empty box.
	 */
	fitFrame(event: Event) {
		const frame = event.target as HTMLIFrameElement;
		const height = frame.contentDocument?.body?.offsetHeight;
		if (height) frame.style.height = `${height}px`;
	}

	/** "820 B", "14 KB" or "2.3 MB". */
	size(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	attachmentUrl(message: InboxMessage, attachment: InboxAttachment): string {
		return this.gateway.attachmentUrl(
			this.mailbox()?.mailboxId ?? '',
			message.id,
			attachment.id,
			attachment.filename,
		);
	}

	compose() {
		const mailbox = this.mailbox();
		if (!mailbox) return;
		this.openId.set(null);
		this.files.set([]);
		this.draft.set({
			mode: 'new',
			from: primaryAddress(mailbox.sendAs, mailbox.address),
			to: '',
			cc: '',
			subject: '',
			body: '',
		});
	}

	startDraft(mode: Exclude<DraftMode, 'new'>) {
		const mailbox = this.mailbox();
		const thread = this.thread();
		if (!mailbox || !thread?.messages.length) return;
		this.files.set([]);
		this.draft.set(draftFor(mode, thread, mailbox.sendAs, mailbox.address));
	}

	editDraft(field: 'to' | 'cc' | 'subject' | 'body', value: string) {
		this.draft.update((draft) => (draft ? { ...draft, [field]: value } : draft));
	}

	chooseFrom(event: Select2UpdateEvent) {
		const value = typeof event.value === 'string' ? event.value : '';
		if (value) this.draft.update((draft) => (draft ? { ...draft, from: value } : draft));
	}

	pickFiles(event: Event) {
		const input = event.target as HTMLInputElement;
		this.files.set(Array.from(input.files ?? []));
	}

	discard() {
		this.draft.set(null);
		this.files.set([]);
	}

	async send() {
		const mailboxId = this.mailbox()?.mailboxId;
		const draft = this.draft();
		if (!mailboxId || !draft || this.sending()) return;
		const problem = draftProblem(draft, this.files());
		if (problem) {
			this.notifier.showError(this.transloco.translate(problem));
			return;
		}
		this.sending.set(true);
		try {
			await firstValueFrom(this.gateway.send(mailboxId, await sendRequest(draft, this.files())));
			this.notifier.showSuccess(this.transloco.translate('inbox_sent'));
			this.discard();
			await this.reload();
		} finally {
			this.sending.set(false);
		}
	}

	/** A new mailbox, folder or search starts from its first page with nothing open. */
	private restart() {
		this.pages.set([]);
		this.back();
	}

	private reload() {
		return this.queryClient.invalidateQueries({ queryKey: INBOX_KEY });
	}
}
