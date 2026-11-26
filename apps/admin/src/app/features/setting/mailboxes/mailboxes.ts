import { DatePipe } from '@angular/common';
import { Component, TemplateRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { MAILBOXES_KEY, MailboxGateway, injectMailboxesQuery } from '@core/mailboxes/mailbox.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

import type { AdminMailboxRow, MailboxAccessList, MailboxPeoplePage, MailboxRight } from '@saha-textile/contracts';

/** The seven rights, in the order the Access popup shows them (owner log § admin Inbox upgrade). */
export const RIGHTS: readonly MailboxRight[] = [
	'read',
	'send',
	'organise',
	'bin',
	'delete_forever',
	'labels',
	'settings',
];

/** What each right cannot work without; the API applies the same rule. */
const NEEDS: Readonly<Record<MailboxRight, readonly MailboxRight[]>> = {
	read: [],
	send: ['read'],
	organise: ['read'],
	bin: ['read'],
	delete_forever: ['bin', 'read'],
	labels: ['read'],
	settings: ['read'],
};

/**
 * Ticking a right ticks what it needs; unticking one unticks what needs it. Unticking Read leaves
 * nothing, which removes the person when the list is saved.
 */
export function toggleRight(rights: readonly MailboxRight[], right: MailboxRight, on: boolean): MailboxRight[] {
	const set = new Set(rights);
	const add = (name: MailboxRight) => {
		set.add(name);
		NEEDS[name].forEach(add);
	};
	const drop = (name: MailboxRight) => {
		set.delete(name);
		RIGHTS.filter((other) => NEEDS[other].includes(name)).forEach(drop);
	};
	if (on) add(right);
	else drop(right);
	return RIGHTS.filter((name) => set.has(name));
}

/** One person in the Access popup. */
export interface AccessLine {
	adminUserId: string;
	name: string;
	email: string;
	active: boolean;
	rights: MailboxRight[];
}

/** Why a Google sign-in came back without a mailbox (`?error=` on the way back). */
const CONNECT_ERRORS: Readonly<Record<string, string>> = {
	cancelled: 'mailbox_connect_cancelled',
	expired: 'mailbox_connect_expired',
	not_on_domain: 'mailbox_connect_not_on_domain',
	not_allowed: 'mailbox_connect_not_allowed',
	failed: 'mailbox_connect_failed',
};

/**
 * Settings › Mailboxes (`mailbox.manage`): connect a sahatextile.com Gmail mailbox through Google's
 * own sign-in, choose who may read or send from it, and where Contact Us messages go. Built from
 * the Stores table, the Settings select and the theme's modals; nothing here is custom.
 */
@Component({
	selector: 'app-mailboxes-settings',
	templateUrl: './mailboxes.html',
	imports: [PageWrapper, TranslocoModule, Select2, FormFields, ConfirmationModal, DatePipe],
})
export class MailboxesSettings {
	private readonly gateway = inject(MailboxGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly router = inject(Router);

	private readonly query = injectMailboxesQuery();
	readonly loading = computed(() => this.query.isPending());
	readonly configured = computed(() => this.query.data()?.configured ?? true);
	readonly domain = computed(() => this.query.data()?.domain ?? '');
	readonly rows = computed(() => this.query.data()?.rows ?? []);
	readonly contactTarget = computed(() => this.rows().find((row) => row.contactTarget)?.mailbox.id ?? null);
	/** Only connected mailboxes may receive Contact Us messages. */
	readonly contactChoices = computed<Select2Data>(() => [
		{ value: '', label: this.transloco.translate('mailbox_contact_none') },
		...this.rows()
			.filter((row) => row.mailbox.status === 'connected')
			.map((row) => ({ value: row.mailbox.id, label: row.mailbox.address })),
	]);
	readonly busy = signal(false);

	readonly rights = RIGHTS;

	/** The Access popup's mailbox, lines, and the list version they were read at. */
	readonly accessFor = signal<AdminMailboxRow | null>(null);
	readonly accessLines = signal<AccessLine[]>([]);
	/** `loading` until the server's list arrives; Save stays off unless it is `ready`. */
	readonly accessState = signal<'loading' | 'ready' | 'failed'>('loading');
	readonly accessVersion = signal(0);
	readonly accessSaving = signal(false);
	/** Someone saved first: their list, kept aside while this person's edits stay on screen. */
	readonly accessTheirs = signal<MailboxAccessList | null>(null);
	readonly canSaveAccess = computed(() => this.accessState() === 'ready' && !this.accessSaving());

	/** The "Add person" search: words, page and what the server found. */
	readonly peopleQuery = signal('');
	readonly peoplePage = signal(1);
	readonly people = signal<MailboxPeoplePage | null>(null);
	readonly peopleFailed = signal(false);
	private peopleTimer: ReturnType<typeof setTimeout> | null = null;
	private peopleAsked = 0;

	constructor() {
		const params = inject(ActivatedRoute).snapshot.queryParamMap;
		const connected = params.get('connected');
		const error = params.get('error');
		if (connected) this.notifier.showSuccess(this.transloco.translate('mailbox_connected', { address: connected }));
		if (error) this.notifier.showError(this.transloco.translate(CONNECT_ERRORS[error] ?? CONNECT_ERRORS['failed']));
		if (connected || error) void this.router.navigate([], { queryParams: {}, replaceUrl: true });
	}

	/** "Working", "Needs reconnecting" or "Disconnected", for the status pill. */
	statusClass(row: AdminMailboxRow): string {
		switch (row.mailbox.status) {
			case 'connected':
				return 'badge bg-success';
			case 'needs_reconnect':
				return 'badge bg-warning text-dark';
			default:
				return row.mailbox.revocation === 'failed' ? 'badge bg-danger' : 'badge bg-secondary';
		}
	}

	/** Sends the browser to Google's sign-in; Google brings it back here. */
	async connect() {
		this.busy.set(true);
		try {
			const { url } = await firstValueFrom(this.gateway.connect());
			this.openGoogle(url);
		} catch {
			this.busy.set(false);
		}
	}

	/** Leaves the admin for Google's page; a separate step so it can be watched in tests. */
	openGoogle(url: string) {
		window.location.assign(url);
	}

	async chooseContact(event: Select2UpdateEvent) {
		const value = typeof event.value === 'string' && event.value ? event.value : null;
		if (value === this.contactTarget()) return;
		await firstValueFrom(this.gateway.setContactTarget(value));
		this.notifier.showSuccess(this.transloco.translate('mailbox_contact_saved'));
		await this.reload();
	}

	async refresh(row: AdminMailboxRow) {
		await firstValueFrom(this.gateway.refresh(row.mailbox.id));
		this.notifier.showSuccess(this.transloco.translate('mailbox_aliases_refreshed'));
		await this.reload();
	}

	/** The confirmation popup's yes. */
	async disconnect(action: { data?: unknown }) {
		const row = action.data as AdminMailboxRow;
		await firstValueFrom(this.gateway.disconnect(row.mailbox.id));
		this.notifier.showSuccess(this.transloco.translate('mailbox_disconnected', { address: row.mailbox.address }));
		await this.reload();
	}

	/**
	 * Opens the Access popup with the people the server says may use this mailbox. The list comes
	 * from the server, not from a user directory page, so nobody is dropped; if it fails to load,
	 * Save stays off rather than saving an empty list.
	 */
	async openAccess(row: AdminMailboxRow, template: TemplateRef<unknown>) {
		this.accessFor.set(row);
		this.accessLines.set([]);
		this.accessTheirs.set(null);
		this.accessState.set('loading');
		this.peopleQuery.set('');
		this.peoplePage.set(1);
		this.people.set(null);
		this.modals.open(template, { centered: true, size: 'xl', windowClass: 'theme-modal' });
		try {
			this.showList(await firstValueFrom(this.gateway.access(row.mailbox.id)));
		} catch {
			this.accessState.set('failed');
		}
		void this.findPeople();
	}

	/** Ticks or unticks one right for one person. */
	setRight(adminUserId: string, right: MailboxRight, on: boolean) {
		this.accessLines.update((lines) =>
			lines.map((line) =>
				line.adminUserId === adminUserId ? { ...line, rights: toggleRight(line.rights, right, on) } : line,
			),
		);
	}

	removePerson(adminUserId: string) {
		this.accessLines.update((lines) => lines.filter((line) => line.adminUserId !== adminUserId));
	}

	/** Adds someone from the search with Read, the least a row can mean. */
	addPerson(person: MailboxPeoplePage['items'][number]) {
		if (this.accessLines().some((line) => line.adminUserId === person.adminUserId)) return;
		this.accessLines.update((lines) => [...lines, { ...person, rights: ['read'] }]);
	}

	isListed(adminUserId: string): boolean {
		return this.accessLines().some((line) => line.adminUserId === adminUserId);
	}

	/** Search as the person types, after a short pause, on the server. */
	searchPeople(words: string) {
		this.peopleQuery.set(words);
		this.peoplePage.set(1);
		if (this.peopleTimer) clearTimeout(this.peopleTimer);
		this.peopleTimer = setTimeout(() => void this.findPeople(), 250);
	}

	pagePeople(step: 1 | -1) {
		this.peoplePage.update((page) => Math.max(1, page + step));
		void this.findPeople();
	}

	/** Only the newest search's answer is shown, so a slow earlier one never overwrites it. */
	async findPeople() {
		const asked = ++this.peopleAsked;
		try {
			const found = await firstValueFrom(this.gateway.people(this.peopleQuery(), this.peoplePage()));
			if (asked !== this.peopleAsked) return;
			this.people.set(found);
			this.peopleFailed.set(false);
		} catch {
			if (asked === this.peopleAsked) this.peopleFailed.set(true);
		}
	}

	/** Replaces this person's edits with the list someone else saved. */
	showTheirs() {
		const theirs = this.accessTheirs();
		if (theirs) this.showList(theirs);
	}

	/**
	 * Saves the list from the version it was read at. When someone saved first, their list is
	 * kept aside, this person's edits stay, and the next Save is a deliberate replacement.
	 */
	async saveAccess(modal: NgbModalRef) {
		const row = this.accessFor();
		if (!row || !this.canSaveAccess()) return;
		this.accessSaving.set(true);
		const entries = this.accessLines()
			.filter((line) => line.rights.length)
			.map((line) => ({ adminUserId: line.adminUserId, rights: line.rights }));
		try {
			await firstValueFrom(this.gateway.saveAccess(row.mailbox.id, this.accessVersion(), entries));
			modal.close();
			this.notifier.showSuccess(this.transloco.translate('mailbox_access_saved'));
			await this.reload();
		} catch (error) {
			if ((error as { status?: number }).status === 409) {
				try {
					const theirs = await firstValueFrom(this.gateway.access(row.mailbox.id));
					this.accessTheirs.set(theirs);
					this.accessVersion.set(theirs.version);
				} catch {
					this.accessState.set('failed');
				}
			} else {
				this.notifier.showError(this.transloco.translate('mailbox_access_not_saved'));
			}
		} finally {
			this.accessSaving.set(false);
		}
	}

	/** Shows Google's withdrawal again for a mailbox it did not confirm. */
	async withdrawAgain(row: AdminMailboxRow) {
		const saved = await firstValueFrom(this.gateway.withdrawAgain(row.mailbox.id));
		if (saved.revocation === 'done') this.notifier.showSuccess(this.transloco.translate('mailbox_withdrawn'));
		else this.notifier.showError(this.transloco.translate('mailbox_withdraw_failed'));
		await this.reload();
	}

	/** "Reconnect to turn on: Delete forever, Settings". */
	reconnectFor(row: AdminMailboxRow): string {
		return row.needsReconnectFor.map((feature) => this.transloco.translate(`mailbox_right_${feature}`)).join(', ');
	}

	private showList(list: MailboxAccessList) {
		this.accessLines.set(list.entries.map((entry) => ({ ...entry, rights: [...entry.rights] })));
		this.accessVersion.set(list.version);
		this.accessTheirs.set(null);
		this.accessState.set('ready');
	}

	private reload() {
		return this.queryClient.invalidateQueries({ queryKey: MAILBOXES_KEY });
	}
}
