import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
	Component,
	DestroyRef,
	type ElementRef,
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

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	NgbDropdown,
	NgbDropdownAnchor,
	NgbDropdownButtonItem,
	NgbDropdownItem,
	NgbDropdownMenu,
	NgbDropdownToggle,
	NgbModal,
	NgbOffcanvas,
} from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { Editor, NgxEditorModule, type Toolbar, toHTML } from 'ngx-editor';
import { type Subscription, firstValueFrom } from 'rxjs';

import { INBOX_KEY, INBOX_REFRESH_MS, MailboxGateway, injectInboxSummaryQuery } from '@core/mailboxes/mailbox.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { LanguageNamePipe, PluralPipe } from '@shared/pipes/language.pipes';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import {
	AUTOSAVE_MS,
	EDITOR_TOOLBAR,
	type Draft,
	type DraftMode,
	addressProblems,
	answeredMessage,
	draftFor,
	draftFromGmail,
	draftKey,
	draftProblem,
	draftWrite,
	editorText,
	firstWords,
	forgetDraft,
	frameDocument,
	gmailDraftKey,
	gmailLink,
	hasContent,
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
	textAsEditorHtml,
} from './inbox-drafts';
import { CATEGORY_KEYS, LABEL_ID, bulkReport, labelTree, pageSelection } from './inbox-labels';
import { PEEK_CLOSE_MS, PEEK_OPEN_MS, type RailMode, initialRail, pageRange, saveRail } from './inbox-layout';
import {
	SEARCH_IN,
	type SearchFields,
	WITHIN_OPTIONS,
	buildQuery,
	emptySearchFields,
	filterFromSearch,
	readQuery,
} from './inbox-search';
import { MailboxSettingsPanel } from './mailbox-settings';
// The theme's toast with one action link, as the file manager's Undo uses it (DEC-UI-REUSE).
import { FmUndoToast } from '../media/file-manager/fm-undo-toast';

import type {
	InboxAttachment,
	InboxDraftSummary,
	InboxSendQueued,
	SavedReply,
	SavedReplyList,
	SavedReplyScope,
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
/** `?draft=open&d=<id>` reopens a Gmail draft from the Drafts folder (C2). */
const DRAFT_MODES: ReadonlySet<string> = new Set(['new', 'reply', 'reply_all', 'forward', 'open']);
type ComposeMode = DraftMode | 'open';

/** The Drafts folder's address segment; Gmail drafts are listed by the drafts API, not as conversations. */
export const DRAFTS_FOLDER = 'drafts';

/** All mailboxes (F1): every readable mailbox's newest Inbox conversations, never the default. */
export const ALL_FOLDER = 'all-mailboxes';

/** The settings screen's address segment (G1), for people with the mailbox's Settings right. */
export const SETTINGS_FOLDER = 'settings';

/** What a queued message's final state says, as a translation key (C4). */
const SEND_OUTCOME: Readonly<Record<string, string>> = {
	sent: 'inbox_sent',
	failed: 'inbox_send_failed_drafts',
	gone: 'inbox_send_gone',
	uncertain: 'inbox_send_uncertain',
};

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
		NgbDropdownToggle,
		NgxEditorModule,
		MailboxSettingsPanel,
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
	private readonly offcanvas = inject(NgbOffcanvas);
	private readonly authStore = inject(AuthStore);
	private readonly toastr = inject(ToastrService);
	private destroyed = false;

	readonly folders = FOLDERS;
	readonly senderName = senderName;
	readonly mailboxKey = mailboxKey;
	readonly listDateFormat = listDateFormat;
	readonly firstWords = firstWords;
	readonly addressProblems = addressProblems;

	private readonly discardModal = viewChild.required<TemplateRef<unknown>>('discardModal');
	private readonly runnableModal = viewChild.required<TemplateRef<unknown>>('runnableModal');
	private readonly foreverModal = viewChild.required<TemplateRef<unknown>>('foreverModal');
	private readonly emptyBinModal = viewChild.required<TemplateRef<unknown>>('emptyBinModal');
	private readonly labelModal = viewChild.required<TemplateRef<unknown>>('labelModal');
	private readonly labelDeleteModal = viewChild.required<TemplateRef<unknown>>('labelDeleteModal');
	private readonly repliesModal = viewChild.required<TemplateRef<unknown>>('repliesModal');
	/** The folder rail, drawn in its column on a wide screen and in a drawer on a phone (R2, R8). */
	private readonly railTemplate = viewChild.required<TemplateRef<unknown>>('railTpl');
	/** The list's own scrolling box (R6): whether it sits at the top decides if new mail slides in. */
	private readonly listBox = viewChild<ElementRef<HTMLElement>>('listBox');
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
	readonly draftMode = computed<ComposeMode | null>(() => {
		const mode = this.queryParams().get('draft') ?? '';
		return DRAFT_MODES.has(mode) ? (mode as ComposeMode) : null;
	});
	/** The Gmail draft named by `?d=` when one is reopened from Drafts. */
	readonly openDraftId = computed(() => (this.draftMode() === 'open' ? this.queryParams().get('d') : null));
	/** The Drafts folder lists Gmail drafts instead of conversations. */
	readonly draftsView = computed(() => this.params().get('folder') === DRAFTS_FOLDER);
	/** The combined list of every mailbox (F1). */
	readonly allView = computed(() => this.params().get('folder') === ALL_FOLDER);
	/** The mailbox's Gmail settings take the list and reading columns (G1). */
	readonly settingsView = computed(() => this.params().get('folder') === SETTINGS_FOLDER);

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
		// Read only once a mailbox is connected (`can`, `canSend`, `readOnly`), so there is always one.
		return new Set<MailboxRight>(mailbox?.rights ?? legacy);
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
	/**
	 * Which mailbox, folder or label is open. Ticks clear when it changes, and stay through search and
	 * pages inside it (decision D7, owner-approved 2026-11-23), as the products table keeps them.
	 */
	private readonly listKey = computed(() =>
		[this.mailbox()?.mailboxId ?? '', this.folder(), this.labelId() ?? ''].join('|'),
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
			enabled:
				Boolean(mailboxId) && this.connected() && !this.draftsView() && !this.settingsView() && !this.allView(),
			refetchInterval: INBOX_REFRESH_MS,
			retry: 1,
		};
	});
	readonly nextPage = computed(() =>
		this.draftsView()
			? (this.draftsQuery.data()?.nextPageToken ?? null)
			: (this.threadsQuery.data()?.nextPageToken ?? null),
	);

	// ── Drafts (C2) ───────────────────────────────────────────────────────────────

	private readonly draftsQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		const pageToken = this.pages().at(-1);
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'drafts', pageToken ?? ''],
			queryFn: () => firstValueFrom(this.gateway.drafts(mailboxId, pageToken)),
			enabled: Boolean(mailboxId) && this.connected() && this.draftsView() && this.canSend(),
			refetchInterval: INBOX_REFRESH_MS,
			retry: 1,
		};
	});
	readonly drafts = computed<InboxDraftSummary[]>(() => this.draftsQuery.data()?.drafts ?? []);

	// ── All mailboxes (F1) ────────────────────────────────────────────────────────

	private readonly allQuery = injectQuery(() => ({
		queryKey: [...INBOX_KEY, 'all-mailboxes'],
		queryFn: () => firstValueFrom(this.gateway.allThreads()),
		enabled: this.allView(),
		refetchInterval: INBOX_REFRESH_MS,
		retry: 1,
	}));
	readonly allThreads = computed(() => this.allQuery.data() ?? { threads: [], skipped: [] });
	readonly loadingAll = computed(() => this.allQuery.isPending());
	readonly allFailed = computed(() => this.allQuery.isError() && !this.allQuery.data());

	allLink(): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), ALL_FOLDER];
	}

	/** A row of the combined list opens in its own mailbox, where its actions and rights apply. */
	allRowLink(row: { mailboxAddress: string; id: string }): string[] {
		return ['/inbox', mailboxKey(row.mailboxAddress), 'inbox', row.id];
	}

	// ── Saved replies (C3) ────────────────────────────────────────────────────────

	private readonly savedRepliesQuery = injectQuery(() => {
		const mailboxId = this.mailbox()?.mailboxId ?? '';
		return {
			queryKey: [...INBOX_KEY, mailboxId, 'saved-replies'],
			queryFn: () => firstValueFrom(this.gateway.savedReplies(mailboxId)),
			enabled: Boolean(mailboxId) && this.canSend() && Boolean(this.draftMode()),
			retry: 1,
		};
	});
	readonly savedReplies = computed<SavedReplyList>(
		() => this.savedRepliesQuery.data() ?? { shared: [], personal: [], canEditShared: false },
	);
	/** The saved reply being written in the manage popup; null shows the list. */
	readonly replyEdit = signal<{ id: string | null; scope: SavedReplyScope; title: string; body: string } | null>(
		null,
	);
	/** The saved reply waiting for "Delete it?" in the manage popup. */
	readonly replyToDelete = signal<SavedReply | null>(null);
	readonly replyProblem = signal<string | null>(null);
	readonly loadingDrafts = computed(() => this.connected() && this.draftsQuery.isPending());
	readonly draftsFailed = computed(() => this.draftsQuery.isError() && !this.draftsQuery.data());
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
	readonly mailboxLabels = computed(() => this.labelsQuery.data() ?? []);
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
	private lastShown: { rows: InboxThreadSummary[]; sent: boolean } = { rows: [], sent: false };
	/**
	 * The rows on screen, and whether they are Sent's (rows there name who they went to). While
	 * another folder, label, search or page loads, the last ones stay, faded under a thin progress
	 * line, instead of the page going blank (Inbox redesign R5).
	 */
	readonly shown = computed(() => {
		if (this.loadingThreads()) return this.lastShown;
		this.lastShown = { rows: this.threads(), sent: this.folder() === 'sent' };
		return this.lastShown;
	});
	readonly shownRows = computed(() => this.shown().rows);
	readonly switching = computed(() => this.loadingThreads() && this.shownRows().length > 0);
	/** A bulk action that partly failed waits in the status line with Retry (A3). */
	readonly retryNote = computed(() => {
		const note = this.bulkNote();
		return note?.retry.length ? note : null;
	});
	/** Rows on a full page of this list, learnt from its first page, for "21–40". */
	private readonly fullPage = signal(0);
	readonly range = computed(() =>
		pageRange(this.pages().length, this.fullPage(), this.threads().length, this.estimate()),
	);
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

	/** Ticked conversations in this mailbox and folder, kept through search and pages (D7). A refresh never ticks new arrivals. */
	readonly selected = signal<ReadonlySet<string>>(new Set());
	/** Every conversation seen in this list, so ticks on another page or before a search keep their rows. */
	private readonly seenRows = new Map<string, InboxThreadSummary>();
	/** "Select all about 130": the action goes to every conversation that matches, read on the server. */
	readonly allMatching = signal(false);
	readonly selection = computed(() =>
		pageSelection(
			this.threads().map((row) => row.id),
			this.selected(),
		),
	);
	private readonly seenVersion = signal(0);
	/** Remembers each row as it is shown, so a tick on an earlier page keeps its row (D7). */
	private readonly rememberRows = effect(() => {
		for (const row of this.threads()) this.seenRows.set(row.id, row);
		untracked(() => this.seenVersion.update((n) => n + 1));
	});
	readonly selectedRows = computed(() => {
		this.seenVersion();
		for (const row of this.threads()) this.seenRows.set(row.id, row);
		return [...this.selected()].flatMap((id) => this.seenRows.get(id) ?? []);
	});
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
	/** Autosave to Gmail (C2): what the line beside Send says. */
	readonly saveState = signal<'idle' | 'saving' | 'saved' | 'offline' | 'failed' | 'conflict'>('idle');
	readonly savedAt = signal<string | null>(null);
	/** A draft reopened from Drafts is being read from Gmail. */
	readonly openingDraft = signal(false);
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private saving: Promise<void> | null = null;
	private saveAgain = false;
	/** Queued messages whose Undo was pressed, so their outcome is not announced. */
	private readonly undone = new Set<string>();
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
	/** The formatting editor for the open draft (C1), the blog form's ngx-editor. */
	readonly editor = signal<Editor | null>(null);
	readonly editorToolbar = EDITOR_TOOLBAR as Toolbar;
	private editorWatch: Subscription | null = null;
	/** Bcc opens on request; a kept draft that has one shows it. */
	readonly bccOpen = signal(false);
	/** Phones show one column at a time: the list, or the open conversation or draft. */
	readonly reading = computed(() => Boolean(this.openId() || this.draftMode()));

	// ── Layout (Inbox redesign, 24 Nov) ───────────────────────────────────────────

	/** The folder rail: pinned open, or icons only (R2). Each person's choice, kept in this browser. */
	readonly rail = signal<RailMode>(initialRail(window.innerWidth));
	/** The icon rail opened over the list by pointing or Tab; nothing moves underneath. */
	readonly railPeek = signal(false);
	private peekTimer: ReturnType<typeof setTimeout> | undefined;
	/** The search options under the search box (R3), and what they hold while open. */
	readonly searchFields = signal<SearchFields>(emptySearchFields());
	readonly withinOptions = WITHIN_OPTIONS;
	readonly searchPlaces = Object.keys(SEARCH_IN);
	/** A filter started from the search options, handed to Mailbox settings › Filters (R3). */
	readonly filterPrefill = signal<ReturnType<typeof filterFromSearch> | null>(null);

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
		inject(DestroyRef).onDestroy(() => {
			this.observers.forEach((observer) => observer.disconnect());
			this.destroyed = true;
			// Leaving the Inbox mid-sentence still saves what was typed.
			this.flushSave();
			this.stopEditor();
		});

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

		// Moving to another mailbox, folder or label clears the selection; search and pages keep it (D7).
		effect(() => {
			this.listKey();
			untracked(() => {
				this.selected.set(new Set());
				this.allMatching.set(false);
				this.seenRows.clear();
			});
		});
		// "Select all about 130" is about one search: a new search or page drops it, the ticks stay.
		effect(() => {
			this.q();
			this.pages();
			untracked(() => this.allMatching.set(false));
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
			this.draftsView();
			this.settingsView();
			this.allView();
			this.labelId();
			this.q();
			untracked(() => {
				this.pages.set([]);
				this.fullPage.set(0);
				this.adoptNext = true;
				this.searchText.set(this.q());
				// A filter started from the search options is offered once, on the way to Settings.
				if (!this.settingsView()) this.filterPrefill.set(null);
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
					this.listScrollTop() < 120;
				if (this.firstPage() && data.nextPageToken) this.fullPage.set(data.threads.length);
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

		// The draft follows `?draft=`: kept text comes back, otherwise a new one starts. A draft
		// reopened from Drafts (`?draft=open&d=`) is read from Gmail.
		effect(() => {
			const mode = this.draftMode();
			const mailbox = this.mailbox();
			const thread = this.thread();
			const threadId = this.openId();
			const gmailId = this.openDraftId();
			untracked(() =>
				mode === 'open'
					? void this.openGmailDraft(mailbox, gmailId)
					: this.loadDraft(mode, mailbox, threadId, thread),
			);
		});
	}

	// ── Navigation ────────────────────────────────────────────────────────────────

	/** The list's address: mailbox and folder (or label), keeping a search. */
	listLink(folder: InboxFolder | null = null): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), folder ?? this.labelId() ?? this.folder()];
	}

	draftsLink(): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), DRAFTS_FOLDER];
	}

	settingsLink(): string[] {
		return ['/inbox', mailboxKey(this.mailbox()?.address ?? ''), SETTINGS_FOLDER];
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
				this.draftsView() ? this.draftsQuery.refetch() : this.threadsQuery.refetch(),
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
		const ids = this.threads().map((row) => row.id);
		const next = new Set(this.selected());
		if (this.selection() === 'all') for (const id of ids) next.delete(id);
		else for (const id of ids) next.add(id);
		this.selected.set(next);
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
			const open = this.openId();
			const openGone = open !== null && result.done.includes(open);
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
		this.modals.open(this.foreverModal(), { centered: true, windowClass: 'theme-modal text-center' });
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
		if (!mailboxId) return;
		this.binCount.set(await firstValueFrom(this.gateway.binSummary(mailboxId)));
		this.modals.open(this.emptyBinModal(), { centered: true, windowClass: 'theme-modal text-center' });
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
		this.modals.open(this.labelModal(), { centered: true, windowClass: 'theme-modal' });
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
		this.modals.open(this.labelDeleteModal(), { centered: true, windowClass: 'theme-modal text-center' });
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
		this.switchTo(String(event.value));
	}

	/** The title row's mailbox switcher (R1): opens the chosen mailbox's Inbox. */
	switchTo(mailboxId: string) {
		const chosen = this.mailboxes().find((entry) => entry.mailboxId === mailboxId);
		if (!chosen || chosen.mailboxId === this.mailbox()?.mailboxId) return;
		void this.router.navigate(['/inbox', mailboxKey(chosen.address), 'inbox']);
	}

	/** Each mailbox's line in the switcher: health, unread and rights, as approved (U1). */
	mailboxState(entry: InboxMailboxSummary): string {
		if (entry.status !== 'connected') return 'inbox_state_reconnect';
		return entry.canSend ? 'inbox_state_send' : 'inbox_state_read';
	}

	// ── Folder rail (R2) and drawer (R8) ──────────────────────────────────────────

	toggleRail() {
		const next: RailMode = this.rail() === 'open' ? 'icons' : 'open';
		this.rail.set(next);
		saveRail(next);
		this.closePeek(true);
	}

	/** Pointing rests on the icons: they open over the list a moment later. */
	peek() {
		if (this.rail() !== 'icons') return;
		clearTimeout(this.peekTimer);
		this.peekTimer = setTimeout(() => this.railPeek.set(true), PEEK_OPEN_MS);
	}

	/** The pointer left, or focus moved out: they close a moment later (or at once). */
	closePeek(now = false) {
		clearTimeout(this.peekTimer);
		if (now) this.railPeek.set(false);
		else this.peekTimer = setTimeout(() => this.railPeek.set(false), PEEK_CLOSE_MS);
	}

	/** Tab into the icons opens them; Tab out of the rail closes them. */
	railFocus(event: FocusEvent, entering: boolean) {
		if (this.rail() !== 'icons') return;
		const rail = event.currentTarget as HTMLElement;
		if (entering) {
			clearTimeout(this.peekTimer);
			this.railPeek.set(true);
		} else if (!rail.contains(event.relatedTarget as Node | null)) this.closePeek(true);
	}

	/** On a phone the folders open in a drawer from the ☰ button (R8). */
	openFolders() {
		this.offcanvas.open(this.railTemplate(), { position: 'start', panelClass: 'inbox-drawer' });
	}

	/** A folder or label was chosen: the opened icons and the phone drawer close. */
	folderChosen() {
		this.closePeek(true);
		if (this.offcanvas.hasOpenOffcanvas()) this.offcanvas.dismiss();
	}

	// ── Search options (R3) ───────────────────────────────────────────────────────

	/** The options read the current search back into their fields, so it can be adjusted. */
	searchOptionsOpened(open: boolean) {
		if (open) this.searchFields.set(readQuery(this.searchText()));
	}

	setSearchField<K extends keyof SearchFields>(field: K, value: SearchFields[K]) {
		this.searchFields.update((fields) => ({ ...fields, [field]: value }));
	}

	searchWithOptions() {
		this.searchText.set(buildQuery(this.searchFields()));
		this.search();
	}

	/** Create filter (Settings right): Mailbox settings › Filters opens with these conditions filled in. */
	createFilter() {
		this.filterPrefill.set(filterFromSearch(this.searchFields()));
		void this.router.navigate(this.settingsLink());
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

	/** Leaves the draft; its text stays kept for this conversation, and waiting changes go to Gmail. */
	closeDraft() {
		this.flushSave();
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { draft: null, d: null },
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
		this.modals.open(this.foreverModal(), { centered: true, windowClass: 'theme-modal text-center' });
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
		this.modals.open(this.runnableModal(), { centered: true, windowClass: 'theme-modal text-center' });
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
		this.scheduleSave();
	}

	/** Changed elsewhere: take the version saved in Gmail, dropping the text typed here. */
	async useTheirs() {
		const mailboxId = this.mailbox()?.mailboxId;
		const gmailId = this.draft()?.gmailDraftId;
		if (!mailboxId || !gmailId) return;
		try {
			const saved = await firstValueFrom(this.gateway.draft(mailboxId, gmailId));
			const draft = { ...draftFromGmail(saved), knownIds: this.draft()?.knownIds ?? [] };
			this.files.set([]);
			this.draft.set(draft);
			this.startEditor(draft);
			const key = this.draftId();
			if (key) keepDraft(key, draft);
			this.saveState.set('saved');
			this.savedAt.set(new Date().toISOString());
		} catch {
			this.saveState.set('failed');
		}
	}

	/** Changed elsewhere: save the text typed here over the other version. */
	keepMine() {
		void this.saveNow(true);
	}

	/** Discard asks first when there is text to lose (review T6). */
	discard() {
		if (this.draft()?.body.trim()) {
			this.modals.open(this.discardModal(), { centered: true, windowClass: 'theme-modal text-center' });
			return;
		}
		void this.discardNow();
	}

	/** Discard deletes the Gmail draft too, once Gmail confirms; until then the text stays. */
	async discardNow() {
		this.modals.dismissAll();
		this.cancelSave();
		await this.saving;
		const mailboxId = this.mailbox()?.mailboxId;
		const gmailId = this.draft()?.gmailDraftId;
		if (mailboxId && gmailId) {
			try {
				await firstValueFrom(this.gateway.deleteDraft(mailboxId, gmailId));
			} catch (error) {
				if (statusOf(error) !== 404) {
					this.notifier.showError(this.transloco.translate('inbox_discard_failed'));
					return;
				}
			}
		}
		const id = this.draftId();
		if (id) forgetDraft(id);
		this.files.set([]);
		this.stopEditor();
		this.draft.set(null);
		this.draftId.set(null);
		this.saveState.set('idle');
		this.closeDraft();
		if (gmailId) await this.reload();
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
		this.cancelSave();
		await this.saving;
		const threadId = draft.threadId;
		try {
			if (threadId && draft.mode !== 'forward' && draft.knownIds.length && !this.forceSend) {
				const latest = await this.queryClient.fetchQuery({
					queryKey: [...INBOX_KEY, mailboxId, 'thread', threadId],
					queryFn: () => firstValueFrom(this.gateway.thread(mailboxId, threadId)),
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
			// The text as it is now, with the Gmail draft the autosave made meanwhile.
			const latest = this.draft() ?? draft;
			const queued = await firstValueFrom(
				this.gateway.send(mailboxId, await sendRequest(latest, this.files(), this.forceSend)),
			);
			this.offerUndo(mailboxId, queued);
			this.forceSend = false;
			this.collision.set(null);
			const id = this.draftId();
			if (id) forgetDraft(id);
			this.files.set([]);
			this.stopEditor();
			this.draft.set(null);
			this.draftId.set(null);
			this.closeDraft();
			await this.reload();
		} catch (error) {
			// The reply stays as typed: "Not sent. Your text is kept." with the reason.
			const status = statusOf(error);
			// The API saw a reply the browser had not (C5): show who, exactly as the browser check does.
			if (status === 412 && threadId) {
				const latest = await this.queryClient
					.fetchQuery({
						queryKey: [...INBOX_KEY, mailboxId, 'thread', threadId],
						queryFn: () => firstValueFrom(this.gateway.thread(mailboxId, threadId)),
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
			if (status === 409 && this.draft()?.gmailDraftId) {
				// A reconnect, or this draft is already on its way from another tab.
				this.sendProblem.set('inbox_already_sending');
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

	/** A change typed or chosen in the compose box: kept in this tab now, saved to Gmail shortly. */
	private updateDraft(change: Partial<Draft>, typed = true) {
		const draft = this.draft();
		if (!draft) return;
		const next = { ...draft, ...change };
		this.draft.set(next);
		const id = this.draftId();
		if (id) keepDraft(id, next);
		if (typed) this.scheduleSave();
	}

	// ── Saved replies (C3) ────────────────────────────────────────────────────────

	/** Puts a saved reply's text where the cursor is in the message, ready to change before sending. */
	insertSavedReply(reply: SavedReply) {
		const editor = this.editor();
		if (editor) {
			editor.commands.focus().insertText(reply.body).exec();
			return;
		}
		const body = this.draft()?.body ?? '';
		const box = document.getElementById('inbox_body') as HTMLTextAreaElement | null;
		const at = box && document.activeElement === box ? box.selectionStart : body.length;
		const next = body.slice(0, at) + reply.body + body.slice(at);
		this.editDraft('body', next);
		const end = at + reply.body.length;
		setTimeout(() => {
			box?.focus();
			box?.setSelectionRange(end, end);
		});
	}

	manageReplies() {
		this.replyEdit.set(null);
		this.replyToDelete.set(null);
		this.replyProblem.set(null);
		this.modals.open(this.repliesModal(), { centered: true, windowClass: 'theme-modal' });
	}

	openReplyEditor(reply: SavedReply | null) {
		this.replyToDelete.set(null);
		this.replyProblem.set(null);
		this.replyEdit.set(
			reply
				? { id: reply.id, scope: reply.scope, title: reply.title, body: reply.body }
				: { id: null, scope: 'personal', title: '', body: '' },
		);
	}

	editReply(field: 'title' | 'body' | 'scope', value: string) {
		const edit = this.replyEdit();
		if (edit) this.replyEdit.set({ ...edit, [field]: value });
	}

	async saveReply() {
		const mailboxId = this.mailbox()?.mailboxId;
		const edit = this.replyEdit();
		const title = edit?.title.trim() ?? '';
		const body = edit?.body.trim() ?? '';
		if (!mailboxId || !edit || !title || !body) return;
		try {
			await firstValueFrom(
				edit.id
					? this.gateway.updateSavedReply(mailboxId, edit.id, { title, body })
					: this.gateway.createSavedReply(mailboxId, { title, body, scope: edit.scope }),
			);
		} catch (error) {
			this.replyProblem.set(statusOf(error) === 409 ? 'inbox_reply_too_many' : 'inbox_reply_failed');
			return;
		}
		this.replyEdit.set(null);
		this.replyProblem.set(null);
		// Said quietly: a toast would close the popup the person is still working in.
		this.announcement.set(this.transloco.translate('inbox_reply_saved'));
		await this.savedRepliesQuery.refetch();
	}

	async deleteReply(reply: SavedReply) {
		const mailboxId = this.mailbox()?.mailboxId;
		if (!mailboxId) return;
		try {
			await firstValueFrom(this.gateway.deleteSavedReply(mailboxId, reply.id));
		} catch (error) {
			if (statusOf(error) !== 404) {
				this.replyProblem.set('inbox_reply_failed');
				return;
			}
		}
		this.replyToDelete.set(null);
		// Said quietly: a toast would close the popup the person is still working in.
		this.announcement.set(this.transloco.translate('inbox_reply_deleted'));
		await this.savedRepliesQuery.refetch();
	}

	// ── Autosave and Undo Send (C2, C4) ───────────────────────────────────────────

	private scheduleSave() {
		this.cancelSave();
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.saveNow();
		}, AUTOSAVE_MS);
	}

	private cancelSave() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
	}

	/** Leaving the compose box saves what is waiting at once instead of dropping it. */
	private flushSave() {
		if (!this.saveTimer) return;
		this.cancelSave();
		void this.saveNow();
	}

	/**
	 * Saves the compose box to Gmail. One save at a time; a change made during one is saved right
	 * after it. "Saved to Gmail" shows only once the API has answered.
	 */
	async saveNow(overwrite = false): Promise<void> {
		if (this.saving) {
			this.saveAgain = true;
			return this.saving;
		}
		const mailboxId = this.mailbox()?.mailboxId;
		const draft = this.draft();
		const key = this.draftId();
		if (!mailboxId || !draft || !key || !this.canSend() || this.sending()) return;
		if (!draft.gmailDraftId && !hasContent(draft)) return;
		const files = this.files();
		this.saveState.set('saving');
		this.saving = (async () => {
			try {
				const body = await draftWrite(draft, files, overwrite);
				const saved = await firstValueFrom(this.gateway.saveDraft(mailboxId, draft.gmailDraftId ?? null, body));
				const uploaded = files.map((file) => ({ name: file.name, size: file.size }));
				const ids = {
					gmailDraftId: saved.draftId,
					version: saved.version,
					savedFiles: [...(draft.savedFiles ?? []), ...uploaded],
				};
				if (this.draftId() !== key) {
					// Saved after the person moved on: the kept copy learns its Gmail draft, so
					// coming back carries on with it instead of starting a second one.
					keepDraft(key, { ...(keptDraft(key, null) ?? draft), ...ids });
					return;
				}
				this.files.update((list) => list.filter((file) => !files.includes(file)));
				this.updateDraft(ids, false);
				this.saveState.set('saved');
				this.savedAt.set(saved.savedAt);
			} catch (error) {
				if (this.draftId() !== key) return;
				const status = statusOf(error);
				if (status === 412) this.saveState.set('conflict');
				else if (status === 404) {
					// Sent or deleted elsewhere: the next save starts a new Gmail draft with this text.
					this.updateDraft({ gmailDraftId: undefined, version: undefined, savedFiles: [] }, false);
					this.saveState.set('failed');
				} else if (status === 0 || !navigator.onLine) {
					this.saveState.set('offline');
				} else this.saveState.set('failed');
			}
		})();
		try {
			await this.saving;
		} finally {
			this.saving = null;
			if (this.saveAgain) {
				this.saveAgain = false;
				this.scheduleSave();
			}
		}
	}

	/** "Sending in 10 seconds. Undo": the theme's toast with one link, for as long as Undo works. */
	private offerUndo(mailboxId: string, queued: InboxSendQueued) {
		const wait = Math.max(1_000, Date.parse(queued.sendAt) - Date.now());
		const seconds = Math.round(wait / 1_000);
		const note = this.transloco.translate('inbox_sending_in', { seconds });
		this.announcement.set(note);
		const toast = this.toastr.info(note, undefined, {
			toastComponent: FmUndoToast,
			timeOut: wait,
			payload: { action: this.transloco.translate('inbox_undo_send') },
		});
		toast.onAction.subscribe(() => void this.undoSend(mailboxId, queued));
		void this.followSend(mailboxId, queued, wait);
	}

	async undoSend(mailboxId: string, queued: InboxSendQueued) {
		this.undone.add(queued.outboxId);
		try {
			const { draftId } = await firstValueFrom(this.gateway.cancelSend(mailboxId, queued.outboxId));
			this.notifier.showSuccess(this.transloco.translate('inbox_send_undone'));
			const key = mailboxKey(this.mailbox()?.address ?? '');
			void this.router.navigate(['/inbox', key, DRAFTS_FOLDER], { queryParams: { draft: 'open', d: draftId } });
		} catch (error) {
			this.undone.delete(queued.outboxId);
			this.notifier.showError(
				this.transloco.translate(statusOf(error) === 409 ? 'inbox_undo_too_late' : 'inbox_undo_failed'),
			);
		}
	}

	/** After the wait: says once whether it went, failed (it stays in Drafts) or is unconfirmed. */
	private async followSend(mailboxId: string, queued: InboxSendQueued, wait: number) {
		const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		await pause(wait + 2_500);
		for (let attempt = 0; attempt < 10 && !this.destroyed; attempt += 1) {
			if (this.undone.has(queued.outboxId)) return;
			const state = await firstValueFrom(this.gateway.outboxStatus(mailboxId, queued.outboxId)).catch(() => null);
			if (state && !['queued', 'sending'].includes(state.status)) {
				const key = SEND_OUTCOME[state.status];
				if (!key) return;
				const note = this.transloco.translate(key);
				if (state.status === 'sent') this.notifier.showSuccess(note);
				else this.notifier.showError(note);
				this.announcement.set(note);
				await this.reload();
				return;
			}
			await pause(2_000);
		}
	}

	private loadDraft(
		mode: DraftMode | null,
		mailbox: InboxMailboxSummary | null,
		threadId: string | null,
		thread: ReturnType<Inbox['thread']>,
	) {
		if (!mode || !mailbox || !this.canSend() || (mode !== 'new' && !thread)) {
			if (!mode) {
				this.stopEditor();
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
		this.showDraft(id, draft);
	}

	/** Reopens a Gmail draft; text kept in this tab since its last save wins over Gmail's copy. */
	private async openGmailDraft(mailbox: InboxMailboxSummary | null, gmailId: string | null) {
		if (!mailbox || !gmailId || !this.canSend()) return;
		const id = gmailDraftKey(mailbox.mailboxId, gmailId);
		if (this.draftId() === id) return;
		this.flushSave();
		const kept = keptDraft(id, null);
		if (kept) {
			this.showDraft(id, kept);
			return;
		}
		this.openingDraft.set(true);
		this.draft.set(null);
		this.draftId.set(id);
		try {
			const saved = await firstValueFrom(this.gateway.draft(mailbox.mailboxId, gmailId));
			if (this.draftId() === id) this.showDraft(id, draftFromGmail(saved));
		} catch (error) {
			if (this.draftId() !== id) return;
			this.draftId.set(null);
			this.notifier.showError(
				this.transloco.translate(statusOf(error) === 404 ? 'inbox_draft_gone' : 'inbox_gmail_unavailable'),
			);
			this.closeDraft();
			await this.reload();
		} finally {
			this.openingDraft.set(false);
		}
	}

	private showDraft(id: string, draft: Draft) {
		this.flushSave();
		this.saveState.set(draft.gmailDraftId ? 'saved' : 'idle');
		this.savedAt.set(null);
		this.files.set([]);
		this.quoteOpen.set(false);
		this.bccOpen.set(Boolean(draft.bcc));
		this.collision.set(null);
		this.sendProblem.set(null);
		this.forceSend = false;
		this.draftId.set(id);
		this.draft.set(draft);
		keepDraft(id, draft);
		this.startEditor(draft);
	}

	/**
	 * A fresh editor holding the draft's words. The content is set before the editor is listened to,
	 * so opening a draft never saves it; every change after that goes through the draft.
	 */
	private startEditor(draft: Draft) {
		this.stopEditor();
		const editor = new Editor();
		editor.setContent(draft.html ?? textAsEditorHtml(draft.body));
		this.editorWatch = editor.valueChanges.subscribe((doc) => {
			const html = toHTML(doc);
			if (html !== this.draft()?.html) this.updateDraft({ html, body: editorText(html) });
		});
		this.editor.set(editor);
	}

	private stopEditor() {
		this.editorWatch?.unsubscribe();
		this.editorWatch = null;
		this.editor()?.destroy();
		this.editor.set(null);
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

	/** How far the list is scrolled: its own box on a wide screen, the page on a phone (R6). */
	private listScrollTop(): number {
		const box = this.listBox()?.nativeElement;
		return box && box.scrollHeight > box.clientHeight ? box.scrollTop : window.scrollY;
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
