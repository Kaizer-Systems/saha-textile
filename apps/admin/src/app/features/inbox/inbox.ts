import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
	Component,
	DestroyRef,
	type TemplateRef,
	computed,
	effect,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	NgbDropdown,
	NgbDropdownAnchor,
	NgbDropdownButtonItem,
	NgbDropdownItem,
	NgbDropdownMenu,
	NgbModal,
} from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { INBOX_KEY, INBOX_REFRESH_MS, MailboxGateway, injectInboxSummaryQuery } from '@core/mailboxes/mailbox.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import {
	type Draft,
	type DraftMode,
	addressProblems,
	answeredMessage,
	draftFor,
	draftKey,
	draftProblem,
	firstWords,
	forgetDraft,
	frameDocument,
	gmailLink,
	isFolded,
	isRunnable,
	keepDraft,
	keptDraft,
	listDateFormat,
	mailboxKey,
	minutesSince,
	newDraft,
	primaryAddress,
	sendRequest,
} from './inbox-drafts';

import type {
	InboxAttachment,
	InboxFolder,
	InboxMailboxSummary,
	InboxMessage,
	InboxModifyRequest,
	InboxThreadSummary,
} from '@saha-textile/contracts';
import { LanguageNamePipe, PluralPipe } from '@shared/pipes/language.pipes';

export const FOLDERS: readonly { id: InboxFolder; icon: string }[] = [
	{ id: 'inbox', icon: 'ri-inbox-line' },
	{ id: 'sent', icon: 'ri-send-plane-line' },
	{ id: 'all', icon: 'ri-mail-line' },
	{ id: 'spam', icon: 'ri-spam-2-line' },
	{ id: 'trash', icon: 'ri-delete-bin-line' },
];

const FOLDER_IDS: ReadonlySet<string> = new Set(FOLDERS.map((entry) => entry.id));
const DRAFT_MODES: ReadonlySet<string> = new Set(['new', 'reply', 'reply_all', 'forward']);

/** What each conversation button says once it has worked. */
const DONE: Readonly<Record<InboxModifyRequest['action'], string>> = {
	mark_read: 'inbox_marked_read',
	mark_unread: 'inbox_marked_unread',
	archive: 'inbox_archived',
	move_to_inbox: 'inbox_moved_to_inbox',
	trash: 'inbox_trashed',
	untrash: 'inbox_untrashed',
	spam: 'inbox_reported_spam',
	not_spam: 'inbox_not_spam_done',
};

/** Why a send failed, by the API's HTTP status, as a translation key. The text is always kept. */
const SEND_FAILED: Readonly<Record<number, string>> = {
	400: 'inbox_from_rejected',
	403: 'inbox_read_only',
	404: 'inbox_thread_gone',
	409: 'inbox_send_reconnect',
	413: 'inbox_files_too_big',
	429: 'inbox_gmail_busy',
};

/** The last mailbox and folder a person used open first next time, in this browser only. */
const LAST_KEY = 'inbox.last';

/** The display name in `Ananya <ananya@example.com>`, or the address when there is none. */
export function senderName(from: string): string {
	const name = from
		.replace(/<[^>]*>/, '')
		.replace(/"/g, '')
		.trim();
	return name || from.replace(/[<>]/g, '').trim();
}

const statusOf = (error: unknown): number => (error instanceof HttpErrorResponse ? error.status : 0);

/**
 * The Inbox (`mailbox.use`): the Gmail mailboxes this admin user was given in Settings › Mailboxes.
 * Folders, the conversation list and the reading pane sit side by side on a wide screen and one at
 * a time on a phone. The page address names the mailbox, folder and conversation, and `?draft=`
 * the reply being written, so Back steps out one level at a time. Gmail stays the only copy of
 * every message; the API reads it live.
 */
@Component({
	selector: 'app-inbox',
	templateUrl: './inbox.html',
	styleUrls: ['./inbox.scss'],
	imports: [
		LanguageNamePipe,
		PluralPipe,
		PageWrapper,
		TranslocoModule,
		Select2,
		DatePipe,
		NgTemplateOutlet,
		FormFields,
		RouterLink,
		NgbDropdown,
		NgbDropdownAnchor,
		NgbDropdownMenu,
		NgbDropdownItem,
		NgbDropdownButtonItem,
	],
	host: { '(window:beforeunload)': 'warnBeforeLeaving($event)' },
})
export class Inbox {
	private readonly gateway = inject(MailboxGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly sanitizer = inject(DomSanitizer);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly authStore = inject(AuthStore);

	readonly folders = FOLDERS;
	readonly senderName = senderName;
	readonly mailboxKey = mailboxKey;
	readonly listDateFormat = listDateFormat;
	readonly firstWords = firstWords;
	readonly addressProblems = addressProblems;

	private readonly discardModal = viewChild<TemplateRef<unknown>>('discardModal');
	private readonly runnableModal = viewChild<TemplateRef<unknown>>('runnableModal');

	// ── The page address ──────────────────────────────────────────────────────────

	private readonly params = toSignal(this.route.paramMap, { requireSync: true });
	private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
	private readonly keyInUrl = computed(() => this.params().get('mailbox'));
	readonly folder = computed<InboxFolder>(() => {
		const folder = this.params().get('folder') ?? 'inbox';
		return FOLDER_IDS.has(folder) ? (folder as InboxFolder) : 'inbox';
	});
	readonly openId = computed(() => this.params().get('thread'));
	readonly q = computed(() => (this.queryParams().get('q') ?? '').trim());
	readonly draftMode = computed<DraftMode | null>(() => {
		const mode = this.queryParams().get('draft') ?? '';
		return DRAFT_MODES.has(mode) ? (mode as DraftMode) : null;
	});

	// ── Mailboxes ─────────────────────────────────────────────────────────────────

	private readonly summary = injectInboxSummaryQuery();
	readonly loadingMailboxes = computed(() => this.summary.isPending());
	readonly summaryFailed = computed(() => this.summary.isError() && !this.summary.data());
	readonly mailboxes = computed(() => this.summary.data() ?? []);
	/**
	 * The address named a mailbox this person may not open (access removed while it was open, or a
	 * changed link). The Inbox moves to one they have and says why.
	 */
	readonly noAccess = signal<string | null>(null);
	readonly mailbox = computed<InboxMailboxSummary | null>(() => {
		const all = this.mailboxes();
		const key = this.keyInUrl();
		return all.find((entry) => mailboxKey(entry.address) === key) ?? all[0] ?? null;
	});
	readonly connected = computed(() => this.mailbox()?.status === 'connected');
	readonly canSend = computed(() => Boolean(this.mailbox()?.canSend) && this.connected());
	readonly readOnly = computed(() => this.connected() && !this.mailbox()?.canSend);
	/** Each choice says what it is before it is opened (review U1). */
	readonly mailboxChoices = computed<Select2Data>(() =>
		this.mailboxes().map((entry) => ({
			value: entry.mailboxId,
			label: entry.address,
			data: {
				unread: entry.unread,
				state:
					entry.status !== 'connected'
						? 'inbox_state_reconnect'
						: entry.canSend
							? 'inbox_state_send'
							: 'inbox_state_read',
				aliases: Math.max(entry.sendAs.length - 1, 0),
				broken: entry.status !== 'connected',
			},
		})),
	);
	readonly fromChoices = computed<Select2Data>(() =>
		(this.mailbox()?.sendAs ?? []).map((entry) => ({
			value: entry.address,
			label: entry.isPrimary ? entry.address : `${entry.address} (${this.transloco.translate('inbox_alias')})`,
		})),
	);
	/** Only someone who manages mailboxes can sign in to one, so only they get "Open in Gmail" (E15). */
	readonly managesMailboxes = computed(() => this.authStore.permissions().includes('mailbox.manage'));

	// ── The list ──────────────────────────────────────────────────────────────────

	/** Page tokens of the pages before this one, so Newer can step back. */
	private readonly pages = signal<string[]>([]);
	readonly firstPage = computed(() => this.pages().length === 0);
	readonly searchText = signal('');
	private readonly listKey = computed(() =>
		[this.mailbox()?.mailboxId ?? '', this.folder(), this.q(), this.pages().at(-1) ?? ''].join('|'),
	);

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
			retry: 1,
		};
	});
	readonly nextPage = computed(() => this.threadsQuery.data()?.nextPageToken ?? null);
	readonly loadingThreads = computed(() => this.connected() && this.threadsQuery.isPending());
	readonly listFailed = computed(() => this.threadsQuery.isError() && !this.threadsQuery.data());

	/**
	 * The list as shown. A refresh that brings new conversations does not reshuffle it under the
	 * pointer: it waits behind "2 new conversations · Show" (review T7). Changes to the rows already
	 * shown (read, unread, a new reply) apply in place.
	 */
	private readonly held = signal<{ key: string; ids: readonly string[] } | null>(null);
	private adoptNext = true;
	readonly threads = computed<InboxThreadSummary[]>(() => {
		const fresh = this.threadsQuery.data()?.threads ?? [];
		const held = this.held();
		if (!held || held.key !== this.listKey()) return fresh;
		const byId = new Map(fresh.map((row) => [row.id, row]));
		return held.ids.flatMap((id) => byId.get(id) ?? []);
	});
	readonly waiting = computed(() => {
		const held = this.held();
		if (!held || held.key !== this.listKey()) return 0;
		const shown = new Set(held.ids);
		return (this.threadsQuery.data()?.threads ?? []).filter((row) => !shown.has(row.id)).length;
	});

	// ── The open conversation ─────────────────────────────────────────────────────

	private readonly threadQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		const threadId = this.openId() ?? '';
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'thread', threadId],
			queryFn: () => firstValueFrom(this.gateway.thread(mailboxId, threadId)),
			enabled: Boolean(mailboxId && threadId) && this.connected(),
			retry: (count: number, error: unknown) => statusOf(error) !== 404 && count < 1,
		};
	});
	readonly thread = computed(() => (this.openId() ? (this.threadQuery.data() ?? null) : null));
	readonly loadingThread = computed(() => Boolean(this.openId()) && this.threadQuery.isPending());
	readonly threadGone = computed(() => this.threadQuery.isError() && statusOf(this.threadQuery.error()) === 404);
	readonly threadFailed = computed(() => this.threadQuery.isError() && !this.threadGone());
	readonly gmailLink = computed(() => {
		const mailbox = this.mailbox();
		const thread = this.thread();
		return mailbox && thread ? gmailLink(mailbox.address, thread.id) : '';
	});

	/** Older read messages fold to one line (review E2); these were opened by hand. */
	readonly opened = signal<ReadonlySet<string>>(new Set());
	readonly allOpen = signal(false);
	/** Messages whose quoted history was unfolded (review E1). */
	private readonly quotesShown = signal<ReadonlySet<string>>(new Set());
	/** Messages whose pictures someone asked to see. */
	private readonly pictures = signal<ReadonlySet<string>>(new Set());
	/** Each message's frame document, built once per message and choice so frames do not reload. */
	readonly frames = computed(() => {
		const shown = this.pictures();
		const quotes = this.quotesShown();
		return new Map<string, SafeHtml>(
			(this.thread()?.messages ?? []).map((message) => [
				message.id,
				// The API cleaned this HTML, and it renders inside a sandbox with no scripts and its
				// own content policy, so Angular's own cleaning (which would strip its styles) is skipped.
				this.sanitizer.bypassSecurityTrustHtml(
					frameDocument(
						quotes.has(message.id) ? message.html + message.quoteHtml : message.html,
						shown.has(message.id),
					),
				),
			]),
		);
	});

	// ── The draft ─────────────────────────────────────────────────────────────────

	readonly draft = signal<Draft | null>(null);
	private readonly draftId = signal<string | null>(null);
	readonly files = signal<File[]>([]);
	readonly sending = signal(false);
	readonly sendProblem = signal<string | null>(null);
	/** Someone else answered after this reply was started (review E9). */
	readonly collision = signal<{ name: string; minutes: number } | null>(null);
	private forceSend = false;
	readonly quoteOpen = signal(false);
	readonly answered = computed(() => {
		const mailbox = this.mailbox();
		const thread = this.thread();
		return mailbox && thread ? answeredMessage(thread, mailbox.sendAs, mailbox.address) : null;
	});
	readonly signature = computed(() => {
		const from = this.draft()?.from;
		const html = this.mailbox()?.sendAs.find((entry) => entry.address === from)?.signature ?? '';
		return html ? this.sanitizer.bypassSecurityTrustHtml(frameDocument(html, true)) : null;
	});
	readonly toProblems = computed(() => addressProblems(this.draft()?.to ?? ''));
	readonly ccProblems = computed(() => addressProblems(this.draft()?.cc ?? ''));
	/** Phones show one column at a time: the list, or the open conversation or draft. */
	readonly reading = computed(() => Boolean(this.openId() || this.draftMode()));

	/** Read out by screen readers when it changes (review T12). */
	readonly announcement = signal('');
	private lastOpened: string | null = null;
	private readonly markedRead = new Set<string>();
	private runnableUrl = '';
	private noAccessShownAt = '';
	private readonly observers: ResizeObserver[] = [];
	readonly runnableName = signal('');

	constructor() {
		inject(DestroyRef).onDestroy(() => this.observers.forEach((observer) => observer.disconnect()));

		// `/inbox` alone opens the mailbox and folder used last; a mailbox the person no longer has
		// falls back to the first one they do have.
		effect(() => {
			const mailbox = this.mailbox();
			if (!mailbox || this.loadingMailboxes()) return;
			const key = mailboxKey(mailbox.address);
			const inUrl = this.keyInUrl();
			if (inUrl === key) return;
			const last = untracked(() => this.remembered());
			const start = this.keyInUrl() === null && last?.mailbox ? last : null;
			const target = start && this.mailboxes().some((entry) => mailboxKey(entry.address) === start.mailbox);
			const goTo = target ? start.mailbox : key;
			const folder = target && FOLDER_IDS.has(start.folder) ? start.folder : 'inbox';
			// The note shows on the page the person lands on, and clears once they move on.
			untracked(() => {
				this.noAccess.set(inUrl);
				this.noAccessShownAt = `${goTo}|${folder}||`;
			});
			void this.router.navigate(['/inbox', goTo, folder], { replaceUrl: true });
		});

		// The "no access" note belongs to the page it was shown on.
		effect(() => {
			const key = this.keyInUrl();
			const here = `${key}|${this.folder()}|${this.openId() ?? ''}|${this.q()}`;
			const settled = this.mailboxes().some((entry) => mailboxKey(entry.address) === key);
			untracked(() => {
				if (settled && this.noAccess() && here !== this.noAccessShownAt) this.noAccess.set(null);
			});
		});

		// A 404 for the list means this person's access was removed while it was open: the
		// mailboxes are read again, it drops out, and the effect above says so.
		effect(() => {
			if (this.threadsQuery.isError() && statusOf(this.threadsQuery.error()) === 404) {
				untracked(() => void this.queryClient.invalidateQueries({ queryKey: INBOX_KEY, exact: true }));
			}
		});

		// Remember where the person is, for next time.
		effect(() => {
			const mailbox = this.mailbox();
			if (!mailbox || this.keyInUrl() !== mailboxKey(mailbox.address)) return;
			this.remember(mailboxKey(mailbox.address), this.folder());
		});

		// A new mailbox, folder or search starts from its first page, with the list taken fresh.
		effect(() => {
			this.mailbox();
			this.folder();
			this.q();
			untracked(() => {
				this.pages.set([]);
				this.adoptNext = true;
				this.searchText.set(this.q());
			});
		});

		// Take a fresh list when asked; otherwise hold the rows shown and count what waits.
		effect(() => {
			const data = this.threadsQuery.data();
			const key = this.listKey();
			if (!data) return;
			untracked(() => {
				const held = this.held();
				const shown = new Set(held?.key === key ? held.ids : []);
				const added = data.threads.some((row) => !shown.has(row.id));
				if (this.adoptNext || held?.key !== key || !added) {
					this.adoptNext = false;
					this.held.set({ key, ids: data.threads.map((row) => row.id) });
				}
			});
		});

		// A conversation that opens: fold its older messages, mark it read as Gmail does, and move
		// focus to its subject.
		effect(() => {
			const thread = this.thread();
			if (!thread) return;
			untracked(() => {
				this.opened.set(new Set());
				this.allOpen.set(false);
				this.quotesShown.set(new Set());
				this.lastOpened = thread.id;
				setTimeout(() => document.getElementById('inbox_subject')?.focus());
				const mailboxId = this.mailbox()?.mailboxId;
				if (thread.unread && mailboxId && !this.markedRead.has(thread.id)) {
					this.markedRead.add(thread.id);
					void this.mark(mailboxId, thread.id);
				}
			});
		});

		// Closing a conversation returns focus to its row.
		effect(() => {
			if (this.openId() || this.draftMode()) return;
			const last = this.lastOpened;
			if (last) setTimeout(() => document.getElementById(`inbox_row_${last}`)?.focus());
		});

		// The draft follows `?draft=`: kept text comes back, otherwise a new one starts.
		effect(() => {
			const mode = this.draftMode();
			const mailbox = this.mailbox();
			const thread = this.thread();
			const threadId = this.openId();
			untracked(() => this.loadDraft(mode, mailbox, threadId, thread));
		});
	}

	// ── Navigation ────────────────────────────────────────────────────────────────

	/** The list's address: mailbox and folder, keeping a search. */
	listLink(folder: InboxFolder = this.folder()): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), folder];
	}

	listQuery(): Record<string, string> | null {
		return this.q() ? { q: this.q() } : null;
	}

	chooseMailbox(event: Select2UpdateEvent) {
		const chosen = this.mailboxes().find((entry) => entry.mailboxId === event.value);
		if (!chosen || chosen.mailboxId === this.mailbox()?.mailboxId) return;
		void this.router.navigate(['/inbox', mailboxKey(chosen.address), 'inbox']);
	}

	/** Search covers All mail (review U11). */
	search() {
		const q = this.searchText().trim();
		if (!q) return this.clearSearch();
		void this.router.navigate(this.listLink('all'), { queryParams: { q } });
	}

	clearSearch() {
		this.searchText.set('');
		void this.router.navigate(this.listLink('inbox'));
	}

	older() {
		const token = this.nextPage();
		if (!token) return;
		this.adoptNext = true;
		this.pages.update((pages) => [...pages, token]);
	}

	newer() {
		this.adoptNext = true;
		this.pages.update((pages) => pages.slice(0, -1));
	}

	/** Shows the conversations that arrived while the list was held. */
	showWaiting() {
		this.adoptNext = true;
		const data = this.threadsQuery.data();
		if (data) this.held.set({ key: this.listKey(), ids: data.threads.map((row) => row.id) });
		this.adoptNext = false;
	}

	back() {
		void this.router.navigate(this.listLink(), { queryParams: this.listQuery() });
	}

	/** Try again, after Gmail did not answer (review T3). */
	reloadMailboxes() {
		void this.summary.refetch();
	}

	retryList() {
		void this.threadsQuery.refetch();
	}

	retryThread() {
		void this.threadQuery.refetch();
	}

	/** Leaves the draft; its text stays kept for this conversation. */
	closeDraft() {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { draft: null },
			queryParamsHandling: 'merge',
		});
	}

	compose() {
		void this.router.navigate(this.listLink(), { queryParams: { ...this.listQuery(), draft: 'new' } });
	}

	startDraft(mode: Exclude<DraftMode, 'new'>) {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { draft: mode },
			queryParamsHandling: 'merge',
		});
	}

	// ── Conversation actions ──────────────────────────────────────────────────────

	/** Archive, trash, restore, spam or mark unread. Anything that moves it out of view closes it. */
	async act(action: InboxModifyRequest['action']) {
		const mailboxId = this.mailbox()?.mailboxId;
		const threadId = this.openId();
		if (!mailboxId || !threadId) return;
		await firstValueFrom(this.gateway.modify(mailboxId, threadId, action));
		// Marked unread on purpose: opening it again marks it read, as Gmail does.
		if (action === 'mark_unread') this.markedRead.delete(threadId);
		const done = this.transloco.translate(DONE[action]);
		this.notifier.showSuccess(done);
		this.announcement.set(done);
		if (action !== 'mark_read') this.back();
		await this.reload();
	}

	isFolded(message: InboxMessage): boolean {
		const messages = this.thread()?.messages ?? [];
		return isFolded(message, messages, this.opened(), this.allOpen());
	}

	unfold(message: InboxMessage) {
		this.opened.update((opened) => new Set([...opened, message.id]));
	}

	quoteShown(message: InboxMessage): boolean {
		return this.quotesShown().has(message.id);
	}

	toggleQuote(message: InboxMessage) {
		this.quotesShown.update((shown) => {
			const next = new Set(shown);
			if (!next.delete(message.id)) next.add(message.id);
			return next;
		});
	}

	picturesShown(message: InboxMessage): boolean {
		return this.pictures().has(message.id);
	}

	showPictures(message: InboxMessage) {
		this.pictures.update((shown) => new Set([...shown, message.id]));
	}

	/**
	 * Fits a message's frame to its content and keeps it fitted when the content changes size
	 * (pictures arriving, quoted text unfolded, the window resized; review T8). It measures the
	 * body, not the page: the page is never shorter than the frame's own 150 px window.
	 */
	fitFrame(event: Event) {
		const frame = event.target as HTMLIFrameElement;
		const body = frame.contentDocument?.body;
		if (!body) return;
		const fit = () => {
			if (body.offsetHeight) frame.style.height = `${body.offsetHeight}px`;
		};
		fit();
		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(fit);
			observer.observe(body);
			this.observers.push(observer);
		}
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

	/** A file that can run programs asks first (review T10). */
	download(event: Event, message: InboxMessage, attachment: InboxAttachment) {
		if (!isRunnable(attachment.filename)) return;
		event.preventDefault();
		this.runnableUrl = this.attachmentUrl(message, attachment);
		this.runnableName.set(attachment.filename);
		const template = this.runnableModal();
		if (template) this.modals.open(template, { centered: true, windowClass: 'theme-modal text-center' });
	}

	downloadAnyway() {
		this.modals.dismissAll();
		window.open(this.runnableUrl, '_blank', 'noopener');
	}

	// ── Draft actions ─────────────────────────────────────────────────────────────

	editDraft(field: 'to' | 'cc' | 'subject' | 'body', value: string) {
		this.updateDraft({ [field]: value });
	}

	chooseFrom(event: Select2UpdateEvent) {
		const value = typeof event.value === 'string' ? event.value : '';
		if (value) this.updateDraft({ from: value });
	}

	setIncludeQuote(include: boolean) {
		this.updateDraft({ includeQuote: include });
	}

	setIncludeAttachments(include: boolean) {
		this.updateDraft({ includeAttachments: include });
	}

	pickFiles(event: Event) {
		const input = event.target as HTMLInputElement;
		this.files.set(Array.from(input.files ?? []));
	}

	/** Discard asks first when there is text to lose (review T6). */
	discard() {
		const template = this.discardModal();
		if (this.draft()?.body.trim() && template) {
			this.modals.open(template, { centered: true, windowClass: 'theme-modal text-center' });
			return;
		}
		this.discardNow();
	}

	discardNow() {
		this.modals.dismissAll();
		const id = this.draftId();
		if (id) forgetDraft(id);
		this.files.set([]);
		this.draft.set(null);
		this.draftId.set(null);
		this.closeDraft();
	}

	/**
	 * Sends, after reading the conversation again: if someone answered after this reply was
	 * started, it stops and says who (review E9), unless the person chose Send anyway.
	 */
	async send() {
		const mailboxId = this.mailbox()?.mailboxId;
		const draft = this.draft();
		if (!mailboxId || !draft || this.sending()) return;
		const problem = draftProblem(draft, this.files());
		if (problem) {
			this.sendProblem.set(problem);
			return;
		}
		this.sendProblem.set(null);
		this.sending.set(true);
		try {
			if (draft.threadId && draft.mode !== 'forward' && draft.knownIds.length && !this.forceSend) {
				const latest = await this.queryClient.fetchQuery({
					queryKey: [...INBOX_KEY, mailboxId, 'thread', draft.threadId],
					queryFn: () => firstValueFrom(this.gateway.thread(mailboxId, draft.threadId ?? '')),
					staleTime: 0,
				});
				const newer = latest.messages.filter((message) => !draft.knownIds.includes(message.id));
				const last = newer.at(-1);
				if (last) {
					this.collision.set({
						name: last.sentBy ?? senderName(last.from),
						minutes: minutesSince(last.date),
					});
					return;
				}
			}
			await firstValueFrom(this.gateway.send(mailboxId, await sendRequest(draft, this.files())));
			const sent = this.transloco.translate('inbox_sent');
			this.notifier.showSuccess(sent);
			this.announcement.set(sent);
			this.forceSend = false;
			this.collision.set(null);
			const id = this.draftId();
			if (id) forgetDraft(id);
			this.files.set([]);
			this.draft.set(null);
			this.draftId.set(null);
			this.closeDraft();
			await this.reload();
		} catch (error) {
			// The reply stays as typed: "Not sent. Your text is kept." with the reason.
			const status = statusOf(error);
			this.sendProblem.set(SEND_FAILED[status] ?? 'inbox_not_sent');
			if (status === 400 || status === 404) await this.reload();
		} finally {
			this.sending.set(false);
		}
	}

	/** After a collision: read what arrived, keep the reply, and count those messages as seen. */
	review() {
		const thread = this.thread();
		this.collision.set(null);
		if (thread) this.updateDraft({ knownIds: thread.messages.map((message) => message.id) });
		this.allOpen.set(true);
	}

	sendAnyway() {
		this.forceSend = true;
		this.collision.set(null);
		void this.send();
	}

	/** Closing the tab loses kept text, so the browser asks first. */
	warnBeforeLeaving(event: BeforeUnloadEvent) {
		if (this.draft()?.body.trim()) event.preventDefault();
	}

	// ── Internals ─────────────────────────────────────────────────────────────────

	private updateDraft(change: Partial<Draft>) {
		const draft = this.draft();
		if (!draft) return;
		const next = { ...draft, ...change };
		this.draft.set(next);
		const id = this.draftId();
		if (id) keepDraft(id, next);
	}

	private loadDraft(
		mode: DraftMode | null,
		mailbox: InboxMailboxSummary | null,
		threadId: string | null,
		thread: ReturnType<Inbox['thread']>,
	) {
		if (!mode || !mailbox || !this.canSend() || (mode !== 'new' && !thread)) {
			if (!mode) {
				this.draft.set(null);
				this.draftId.set(null);
				this.collision.set(null);
				this.sendProblem.set(null);
			}
			return;
		}
		const id = draftKey(mailbox.mailboxId, mode === 'new' ? null : threadId, mode);
		if (this.draftId() === id) return;
		const kept = keptDraft(id, mode);
		const draft =
			kept ??
			(mode === 'new' || !thread
				? newDraft(primaryAddress(mailbox.sendAs, mailbox.address))
				: draftFor(mode, thread, mailbox.sendAs, mailbox.address));
		this.files.set([]);
		this.quoteOpen.set(false);
		this.collision.set(null);
		this.sendProblem.set(null);
		this.forceSend = false;
		this.draftId.set(id);
		this.draft.set(draft);
		keepDraft(id, draft);
	}

	private async mark(mailboxId: string, threadId: string) {
		await firstValueFrom(this.gateway.modify(mailboxId, threadId, 'mark_read'));
		await this.reload();
	}

	private remembered(): { mailbox: string; folder: string } | null {
		try {
			const value: unknown = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
			const last = value as { mailbox?: unknown; folder?: unknown } | null;
			return last && typeof last.mailbox === 'string' && typeof last.folder === 'string'
				? { mailbox: last.mailbox, folder: last.folder }
				: null;
		} catch {
			return null;
		}
	}

	private remember(mailbox: string, folder: string) {
		try {
			localStorage.setItem(LAST_KEY, JSON.stringify({ mailbox, folder }));
		} catch {
			// A blocked store only means the Inbox opens on the first mailbox next time.
		}
	}

	/** After anything changes in Gmail, the lists and counts are read again and taken fresh. */
	private reload() {
		this.adoptNext = true;
		return this.queryClient.invalidateQueries({ queryKey: INBOX_KEY });
	}
}
