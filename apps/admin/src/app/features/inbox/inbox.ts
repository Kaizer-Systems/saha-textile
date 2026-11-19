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
import { LanguageNamePipe, PluralPipe } from '@shared/pipes/language.pipes';
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
import { CATEGORY_KEYS, LABEL_ID, bulkReport, labelTree, pageSelection } from './inbox-labels';

import type {
	InboxAttachment,
	InboxBulkRequest,
	InboxFolder,
	InboxMailboxSummary,
	InboxMessage,
	InboxModifyRequest,
	InboxThreadSummary,
	MailboxRight,
} from '@saha-textile/contracts';

export const FOLDERS: readonly { id: InboxFolder; icon: string }[] = [
	{ id: 'inbox', icon: 'ri-inbox-line' },
	{ id: 'starred', icon: 'ri-star-line' },
	{ id: 'important', icon: 'ri-bookmark-line' },
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
	star: 'inbox_starred',
	unstar: 'inbox_unstarred',
	important: 'inbox_marked_important',
	not_important: 'inbox_marked_not_important',
	add_label: 'inbox_label_added',
	remove_label: 'inbox_label_removed',
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
	private readonly foreverModal = viewChild<TemplateRef<unknown>>('foreverModal');
	private readonly emptyBinModal = viewChild<TemplateRef<unknown>>('emptyBinModal');
	private readonly labelModal = viewChild<TemplateRef<unknown>>('labelModal');
	private readonly labelDeleteModal = viewChild<TemplateRef<unknown>>('labelDeleteModal');
	readonly categoryKeys = CATEGORY_KEYS;

	// ── The page address ──────────────────────────────────────────────────────────

	private readonly params = toSignal(this.route.paramMap, { requireSync: true });
	private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
	private readonly keyInUrl = computed(() => this.params().get('mailbox'));
	readonly folder = computed<InboxFolder>(() => {
		const folder = this.params().get('folder') ?? 'inbox';
		return FOLDER_IDS.has(folder) ? (folder as InboxFolder) : 'inbox';
	});
	/** A custom label or category named where a folder would be (`/inbox/wecare/Label_123`). */
	readonly labelId = computed(() => {
		const segment = this.params().get('folder') ?? '';
		return !FOLDER_IDS.has(segment) && LABEL_ID.test(segment) ? segment : null;
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
	/** This person's rights in the open mailbox; buttons follow them, and the API checks them again. */
	private readonly rights = computed(() => {
		const mailbox = this.mailbox();
		// A summary from before rights existed meant read, or read-and-send (migration 0007).
		const legacy: MailboxRight[] = mailbox?.canSend ? ['read', 'send', 'organise', 'bin'] : ['read'];
		return new Set<MailboxRight>(mailbox?.rights ?? (mailbox ? legacy : []));
	});
	readonly canSend = computed(() => this.connected() && this.rights().has('send'));
	readonly readOnly = computed(() => this.connected() && !this.rights().has('send'));
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
		[
			this.mailbox()?.mailboxId ?? '',
			this.folder(),
			this.labelId() ?? '',
			this.q(),
			this.pages().at(-1) ?? '',
		].join('|'),
	);

	private readonly threadsQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		const folder = this.folder();
		const label = this.labelId() ?? undefined;
		const q = this.q();
		const pageToken = this.pages().at(-1);
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'threads', folder, label ?? '', q, pageToken ?? ''],
			queryFn: () => firstValueFrom(this.gateway.threads(mailboxId, folder, q || undefined, pageToken, label)),
			enabled: Boolean(mailboxId) && this.connected(),
			refetchInterval: INBOX_REFRESH_MS,
			retry: 1,
		};
	});
	readonly nextPage = computed(() => this.threadsQuery.data()?.nextPageToken ?? null);
	readonly estimate = computed(() => this.threadsQuery.data()?.estimate ?? null);
	/** When Gmail last answered for this list: what "Checked 10:42" shows. */
	readonly checkedAt = computed(() => this.threadsQuery.dataUpdatedAt() || null);

	// ── Labels ────────────────────────────────────────────────────────────────────

	private readonly labelsQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'labels'],
			queryFn: () => firstValueFrom(this.gateway.labels(mailboxId)),
			enabled: Boolean(mailboxId) && this.connected(),
			refetchInterval: INBOX_REFRESH_MS,
			retry: 1,
		};
	});
	readonly labelLists = computed(() => labelTree(this.labelsQuery.data() ?? []));
	private readonly labelNames = computed(
		() => new Map(this.labelLists().labels.map((label) => [label.id, label.name] as const)),
	);
	/** The label or category the list shows, for its heading and empty text. */
	readonly currentLabel = computed(() => {
		const id = this.labelId();
		if (!id) return null;
		const lists = this.labelLists();
		return [...lists.labels, ...lists.categories].find((label) => label.id === id) ?? null;
	});
	readonly labelEdit = signal<{ id: string | null; name: string } | null>(null);
	readonly labelToDelete = signal<{ id: string; name: string } | null>(null);
	readonly loadingThreads = computed(() => this.connected() && this.threadsQuery.isPending());
	readonly listFailed = computed(() => this.threadsQuery.isError() && !this.threadsQuery.data());
	/** Gmail stopped answering after the list loaded: the rows stay, with when they were read (X1). */
	readonly listStale = computed(() => this.threadsQuery.isError() && Boolean(this.threadsQuery.data()));

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
	// ── Selection ─────────────────────────────────────────────────────────────────

	/** Ticked conversations on this list. A refresh never ticks new arrivals; moving away clears it. */
	readonly selected = signal<ReadonlySet<string>>(new Set());
	/** "Select all about 130": the action goes to every conversation that matches, read on the server. */
	readonly allMatching = signal(false);
	readonly selection = computed(() =>
		pageSelection(
			this.threads().map((row) => row.id),
			this.selected(),
		),
	);
	readonly selectedRows = computed(() => this.threads().filter((row) => this.selected().has(row.id)));
	readonly selectionHasUnread = computed(() => this.selectedRows().some((row) => row.unread));
	readonly selectionHasRead = computed(() => this.selectedRows().some((row) => !row.unread));
	readonly bulkBusy = signal(false);
	readonly bulkNote = signal<{ key: string; params: Record<string, number>; retry: string[] } | null>(null);
	private lastBulk: { action: InboxBulkRequest['action']; labelId?: string } | null = null;
	readonly binCount = signal<{ threads: number; messages: number } | null>(null);
	readonly refreshing = signal(false);

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
			// The open conversation is checked as often as the list, so new replies show (R5).
			refetchInterval: INBOX_REFRESH_MS,
			retry: (count: number, error: unknown) => statusOf(error) !== 404 && count < 1,
		};
	});
	/** The open conversation as Gmail has it now, new replies included. */
	private readonly fullThread = computed(() => (this.openId() ? (this.threadQuery.data() ?? null) : null));
	/**
	 * The messages on screen (R5). A reply that arrives while the conversation is open waits behind
	 * "1 new reply · Show": it stays unread in Gmail, and nothing already shown moves or reloads.
	 */
	private readonly shownIds = signal<{ threadId: string; ids: ReadonlySet<string> } | null>(null);
	readonly thread = computed(() => {
		const thread = this.fullThread();
		const shown = this.shownIds();
		if (!thread || !shown || shown.threadId !== thread.id) return thread;
		return { ...thread, messages: thread.messages.filter((message) => shown.ids.has(message.id)) };
	});
	readonly newReplies = computed(() => {
		const thread = this.fullThread();
		const shown = this.shownIds();
		if (!thread || !shown || shown.threadId !== thread.id) return 0;
		return thread.messages.filter((message) => !shown.ids.has(message.id)).length;
	});
	/** Rows that just slid in at the top of the list (R3), tinted for a moment. */
	readonly arrived = signal<ReadonlySet<string>>(new Set());
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
	/** Very large messages someone asked to see formatted (E13); the rest of them open as text. */
	private readonly formatted = signal<ReadonlySet<string>>(new Set());
	/** Messages whose pictures someone asked to see. */
	private readonly pictures = signal<ReadonlySet<string>>(new Set());
	/**
	 * Each message's frame document, built once per message and choice and then reused, so a refresh
	 * or a newly shown reply never reloads the frames already on screen (R5).
	 */
	private readonly frameCache = new Map<string, SafeHtml>();
	readonly frames = computed(() => {
		const shown = this.pictures();
		const quotes = this.quotesShown();
		return new Map<string, SafeHtml>(
			(this.thread()?.messages ?? []).map((message) => {
				const key = `${message.id}|${shown.has(message.id)}|${quotes.has(message.id)}`;
				let frame = this.frameCache.get(key);
				if (!frame) {
					// The API cleaned this HTML, and it renders inside a sandbox with no scripts and its
					// own content policy, so Angular's own cleaning (which would strip its styles) is skipped.
					frame = this.sanitizer.bypassSecurityTrustHtml(
						frameDocument(
							quotes.has(message.id) ? message.html + message.quoteHtml : message.html,
							shown.has(message.id),
						),
					);
					this.frameCache.set(key, frame);
				}
				return [message.id, frame] as const;
			}),
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
	readonly bccProblems = computed(() => addressProblems(this.draft()?.bcc ?? ''));
	/** Bcc opens on request; a kept draft that has one shows it. */
	readonly bccOpen = signal(false);
	/** Phones show one column at a time: the list, or the open conversation or draft. */
	readonly reading = computed(() => Boolean(this.openId() || this.draftMode()));

	/** Read out by screen readers when it changes (review T12). */
	readonly announcement = signal('');
	private lastOpened: string | null = null;
	/**
	 * Messages already marked read from here, as `mailbox:message` (R6). Keyed by message, not by
	 * conversation, so a reply that arrives later is marked when it is shown; a failed mark is
	 * forgotten so it is tried again.
	 */
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

		// Moving to another list (mailbox, folder, label, search or page) clears the selection.
		effect(() => {
			this.listKey();
			untracked(() => {
				this.selected.set(new Set());
				this.allMatching.set(false);
			});
		});

		// A label deleted or renamed away in Gmail: its old address lands on the Inbox with a note.
		effect(() => {
			const id = this.labelId();
			const loaded = this.labelsQuery.isSuccess();
			if (!id || !loaded || this.currentLabel()) return;
			untracked(() => {
				this.notifier.showError(this.transloco.translate('inbox_label_gone'));
				void this.router.navigate(this.listLink('inbox'), { replaceUrl: true });
			});
		});

		// A new mailbox, folder or search starts from its first page, with the list taken fresh.
		effect(() => {
			this.mailbox();
			this.folder();
			this.labelId();
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
				const fresh = data.threads.map((row) => row.id);
				const added = fresh.filter((id) => !shown.has(id));
				// New mail slides in only where it cannot disturb anyone (R3): top of the first page of a
				// folder, no search, nothing ticked, nothing open. Otherwise it waits behind the pill.
				const calm =
					held?.key === key &&
					this.firstPage() &&
					!this.q() &&
					!this.selected().size &&
					!this.allMatching() &&
					!this.openId() &&
					!this.draftMode() &&
					(typeof window === 'undefined' || window.scrollY < 120);
				if (this.adoptNext || held?.key !== key || !added.length || calm) {
					if (calm && !this.adoptNext && added.length) this.slideIn(added);
					this.adoptNext = false;
					this.held.set({ key, ids: fresh });
				}
			});
		});

		// A conversation that opens: fold its older messages, mark it read as Gmail does, and move
		// focus to its subject.
		effect(() => {
			const full = this.fullThread();
			if (full) {
				untracked(() => {
					const shown = this.shownIds();
					if (!shown || shown.threadId !== full.id) {
						this.shownIds.set({
							threadId: full.id,
							ids: new Set(full.messages.map((message) => message.id)),
						});
					}
				});
			}
			const thread = this.thread();
			if (!thread) return;
			untracked(() => {
				// A refresh of the same conversation keeps what was unfolded, its quotes and pictures.
				if (this.lastOpened !== thread.id) {
					this.opened.set(new Set());
					this.allOpen.set(false);
					this.quotesShown.set(new Set());
					this.lastOpened = thread.id;
					setTimeout(() => document.getElementById('inbox_subject')?.focus());
				}
				const mailboxId = this.mailbox()?.mailboxId;
				if (!mailboxId) return;
				const unseen = thread.messages
					.filter((message) => message.unread && !this.markedRead.has(`${mailboxId}:${message.id}`))
					.map((message) => message.id);
				if (unseen.length) void this.markShown(mailboxId, unseen);
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

	/** The list's address: mailbox and folder (or label), keeping a search. */
	listLink(folder: InboxFolder | null = null): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), folder ?? this.labelId() ?? this.folder()];
	}

	labelLink(labelId: string): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), labelId];
	}

	/** The custom labels a row carries, by name; categories and system labels are not chips. */
	rowLabels(row: InboxThreadSummary): string[] {
		const names = this.labelNames();
		return row.labelIds.flatMap((id) => (id === this.labelId() ? [] : (names.get(id) ?? [])));
	}

	can(right: MailboxRight): boolean {
		return this.connected() && this.rights().has(right);
	}

	// ── Refresh ───────────────────────────────────────────────────────────────────

	/**
	 * Asks Gmail now for the counts, labels, this list and the open conversation (R1). The API
	 * checks Gmail's change marker first, so unchanged mail still costs almost nothing. A second
	 * click while one runs does nothing; a manual failure says so once.
	 */
	async refresh() {
		if (this.refreshing()) return;
		this.refreshing.set(true);
		this.adoptNext = true;
		try {
			const results = await Promise.all([
				this.summary.refetch(),
				this.labelsQuery.refetch(),
				this.threadsQuery.refetch(),
				...(this.openId() ? [this.threadQuery.refetch()] : []),
			]);
			const failed = results.some((result) => result.isError);
			const note = this.transloco.translate(failed ? 'inbox_refresh_failed' : 'inbox_refreshed');
			if (failed) this.notifier.showError(note);
			this.announcement.set(note);
		} finally {
			this.refreshing.set(false);
		}
	}

	// ── Selection and bulk actions ────────────────────────────────────────────────

	toggleRow(threadId: string, on: boolean) {
		this.allMatching.set(false);
		this.bulkNote.set(null);
		this.selected.update((selected) => {
			const next = new Set(selected);
			if (on) next.add(threadId);
			else next.delete(threadId);
			return next;
		});
	}

	/** The Select all box: ticks this page only; a second step reaches every match. */
	toggleAll() {
		this.allMatching.set(false);
		this.bulkNote.set(null);
		this.selected.set(this.selection() === 'all' ? new Set() : new Set(this.threads().map((row) => row.id)));
	}

	selectAllMatching() {
		this.allMatching.set(true);
	}

	clearSelection() {
		this.selected.set(new Set());
		this.allMatching.set(false);
	}

	/**
	 * One action on the ticked conversations, or on every match. What failed stays ticked with a
	 * Retry for just those; what moved out of view disappears on the refresh that follows.
	 */
	async bulk(action: InboxBulkRequest['action'], labelId?: string, threadIds?: readonly string[]) {
		const mailboxId = this.mailbox()?.mailboxId;
		if (!mailboxId || this.bulkBusy()) return;
		const ids = threadIds ?? [...this.selected()];
		const matching = !threadIds && this.allMatching();
		if (!matching && !ids.length) return;
		this.bulkBusy.set(true);
		this.lastBulk = { action, labelId };
		try {
			const result = await firstValueFrom(
				this.gateway.bulk(mailboxId, {
					action,
					...(labelId ? { labelId } : {}),
					...(matching
						? {
								matching: {
									folder: this.folder(),
									label: this.labelId() ?? undefined,
									q: this.q() || undefined,
								},
							}
						: { threadIds: [...ids] }),
				}),
			);
			const report = bulkReport(result);
			this.bulkNote.set(report.retry.length || result.failed.length ? report : null);
			this.selected.set(new Set(report.retry));
			this.allMatching.set(false);
			const message = this.transloco.translate(report.key, report.params);
			if (result.failed.length) this.notifier.showError(message);
			else this.notifier.showSuccess(message);
			if (result.partlyKept.length) {
				this.notifier.showSuccess(
					this.transloco.translate('inbox_bulk_partly_kept', { count: result.partlyKept.length }),
				);
			}
			if (result.truncated)
				this.notifier.showError(this.transloco.translate('inbox_bulk_truncated', { count: 5000 }));
			this.announcement.set(message);
			const openGone = this.openId() && result.done.includes(this.openId() ?? '');
			if (
				openGone &&
				!['mark_read', 'mark_unread', 'star', 'unstar', 'important', 'not_important'].includes(action)
			) {
				this.back();
			}
		} catch (error) {
			this.notifier.showError(
				this.transloco.translate(
					statusOf(error) === 409 ? 'inbox_reconnect_needed_for' : 'inbox_refresh_failed',
				),
			);
		} finally {
			this.bulkBusy.set(false);
			await this.reload();
		}
	}

	retryBulk() {
		const last = this.lastBulk;
		const retry = this.bulkNote()?.retry ?? [];
		if (last && retry.length) void this.bulk(last.action, last.labelId, retry);
	}

	/** Mark read or unread for the selection: one choice, or both when it is mixed. */
	markSelection(read: boolean) {
		void this.bulk(read ? 'mark_read' : 'mark_unread');
	}

	/** Adds a label to the selection, or removes it when every ticked row already has it. */
	labelSelection(labelId: string) {
		const all =
			this.selectedRows().length > 0 && this.selectedRows().every((row) => row.labelIds.includes(labelId));
		void this.bulk(all ? 'remove_label' : 'add_label', labelId);
	}

	/** Delete outside the Bin moves to the Bin; inside the Bin it asks before deleting for good. */
	deleteSelection() {
		if (this.folder() !== 'trash' || this.labelId()) {
			void this.bulk('trash');
			return;
		}
		const template = this.foreverModal();
		if (template) this.modals.open(template, { centered: true, windowClass: 'theme-modal text-center' });
	}

	/** How many the Delete forever popup names: the ticked rows, or Gmail's count of every match. */
	foreverCount(): number {
		return this.allMatching() ? (this.estimate() ?? this.selected().size) : this.selected().size || 1;
	}

	deleteForeverNow() {
		this.modals.dismissAll();
		const open = this.openId();
		void this.bulk(
			'delete_forever',
			undefined,
			this.selected().size || this.allMatching() ? undefined : open ? [open] : [],
		);
	}

	/** Star or unstar one row without opening it. */
	async toggleStar(event: Event, row: InboxThreadSummary) {
		event.preventDefault();
		event.stopPropagation();
		const mailboxId = this.mailbox()?.mailboxId;
		if (!mailboxId || !this.can('organise')) return;
		await firstValueFrom(this.gateway.modify(mailboxId, row.id, row.starred ? 'unstar' : 'star'));
		await this.reload();
	}

	// ── The Bin ───────────────────────────────────────────────────────────────────

	/** Empty Bin asks with Gmail's own count of what will go. */
	async askEmptyBin() {
		const mailboxId = this.mailbox()?.mailboxId;
		const template = this.emptyBinModal();
		if (!mailboxId || !template) return;
		this.binCount.set(await firstValueFrom(this.gateway.binSummary(mailboxId)));
		this.modals.open(template, { centered: true, windowClass: 'theme-modal text-center' });
	}

	async emptyBinNow() {
		const mailboxId = this.mailbox()?.mailboxId;
		this.modals.dismissAll();
		if (!mailboxId) return;
		const result = await firstValueFrom(this.gateway.emptyBin(mailboxId));
		const key = result.incomplete ? 'inbox_bin_partly_emptied' : 'inbox_bin_emptied';
		const message = this.transloco.translate(key, { count: result.deletedMessages });
		if (result.incomplete) this.notifier.showError(message);
		else this.notifier.showSuccess(message);
		this.announcement.set(message);
		if (this.openId()) this.back();
		await this.reload();
	}

	// ── Label management ──────────────────────────────────────────────────────────

	openLabelEditor(label: { id: string; name: string } | null) {
		this.labelEdit.set(label ? { ...label } : { id: null, name: '' });
		const template = this.labelModal();
		if (template) this.modals.open(template, { centered: true, windowClass: 'theme-modal' });
	}

	async saveLabel() {
		const mailboxId = this.mailbox()?.mailboxId;
		const edit = this.labelEdit();
		const name = edit?.name.trim() ?? '';
		if (!mailboxId || !edit || !name) return;
		await firstValueFrom(
			edit.id ? this.gateway.renameLabel(mailboxId, edit.id, name) : this.gateway.createLabel(mailboxId, name),
		);
		this.modals.dismissAll();
		this.notifier.showSuccess(this.transloco.translate('inbox_label_saved'));
		await this.reload();
	}

	askDeleteLabel(label: { id: string; name: string }) {
		this.labelToDelete.set(label);
		const template = this.labelDeleteModal();
		if (template) this.modals.open(template, { centered: true, windowClass: 'theme-modal text-center' });
	}

	async deleteLabelNow() {
		const mailboxId = this.mailbox()?.mailboxId;
		const label = this.labelToDelete();
		this.modals.dismissAll();
		if (!mailboxId || !label) return;
		await firstValueFrom(this.gateway.deleteLabel(mailboxId, label.id));
		this.notifier.showSuccess(this.transloco.translate('inbox_label_deleted'));
		if (this.labelId() === label.id) void this.router.navigate(this.listLink('inbox'));
		await this.reload();
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

	/** Reveals replies that arrived while the conversation was open, and moves to the first one. */
	showNewReplies() {
		const full = this.fullThread();
		const shown = this.shownIds();
		if (!full || !shown) return;
		const first = full.messages.find((message) => !shown.ids.has(message.id));
		this.shownIds.set({ threadId: full.id, ids: new Set(full.messages.map((message) => message.id)) });
		const note = this.transloco.translate('inbox_new_replies_shown');
		this.announcement.set(note);
		if (first) setTimeout(() => document.getElementById(`inbox_frame_${first.id}`)?.focus());
	}

	/** Tints rows that just slid in, for a moment (approved custom piece 1). */
	private slideIn(ids: readonly string[]) {
		this.arrived.set(new Set(ids));
		this.announcement.set(this.transloco.translate('inbox_new_arrived', { count: ids.length }));
		setTimeout(() => this.arrived.set(new Set()), 4000);
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
	async act(action: InboxModifyRequest['action'], labelId?: string) {
		const mailboxId = this.mailbox()?.mailboxId;
		const threadId = this.openId();
		if (!mailboxId || !threadId) return;
		await firstValueFrom(this.gateway.modify(mailboxId, threadId, action, labelId));
		// Marked unread on purpose: opening it again marks it read, as Gmail does.
		if (action === 'mark_unread') {
			for (const message of this.thread()?.messages ?? []) this.markedRead.delete(`${mailboxId}:${message.id}`);
		}
		const done = this.transloco.translate(DONE[action]);
		this.notifier.showSuccess(done);
		this.announcement.set(done);
		const stays = ['mark_read', 'star', 'unstar', 'important', 'not_important', 'add_label', 'remove_label'];
		if (!stays.includes(action)) this.back();
		await this.reload();
	}

	/** Delete forever for the open conversation, inside the Bin, after the same question. */
	deleteOpenForever() {
		this.clearSelection();
		const template = this.foreverModal();
		if (template) this.modals.open(template, { centered: true, windowClass: 'theme-modal text-center' });
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

	/** A very large message shows its text until someone asks for the formatted version (E13). */
	plainFirst(message: InboxMessage): boolean {
		return message.large && !this.formatted().has(message.id);
	}

	showFormatted(message: InboxMessage) {
		this.formatted.update((shown) => new Set([...shown, message.id]));
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

	editDraft(field: 'to' | 'cc' | 'bcc' | 'subject' | 'body', value: string) {
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
			await firstValueFrom(this.gateway.send(mailboxId, await sendRequest(draft, this.files(), this.forceSend)));
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
			// The API saw a reply the browser had not (C5): show who, exactly as the browser check does.
			if (status === 412 && draft.threadId) {
				const latest = await this.queryClient
					.fetchQuery({
						queryKey: [...INBOX_KEY, mailboxId, 'thread', draft.threadId],
						queryFn: () => firstValueFrom(this.gateway.thread(mailboxId, draft.threadId ?? '')),
						staleTime: 0,
					})
					.catch(() => null);
				const last = latest?.messages.filter((message) => !draft.knownIds.includes(message.id)).at(-1);
				this.collision.set(
					last
						? { name: last.sentBy ?? senderName(last.from), minutes: minutesSince(last.date) }
						: { name: '', minutes: 0 },
				);
				return;
			}
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
		this.bccOpen.set(Boolean(draft.bcc));
		this.collision.set(null);
		this.sendProblem.set(null);
		this.forceSend = false;
		this.draftId.set(id);
		this.draft.set(draft);
		keepDraft(id, draft);
	}

	/** Marks exactly the messages shown; on failure they are forgotten so the next view tries again. */
	private async markShown(mailboxId: string, messageIds: readonly string[]) {
		const keys = messageIds.map((id) => `${mailboxId}:${id}`);
		keys.forEach((key) => this.markedRead.add(key));
		try {
			await firstValueFrom(this.gateway.markMessages(mailboxId, messageIds, true));
		} catch {
			keys.forEach((key) => this.markedRead.delete(key));
			return;
		}
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
