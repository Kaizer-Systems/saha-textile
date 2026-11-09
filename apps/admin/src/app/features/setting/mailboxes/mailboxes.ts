import { DatePipe } from '@angular/common';
import { Component, TemplateRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { MAILBOXES_KEY, MailboxGateway, injectMailboxesQuery } from '@core/mailboxes/mailbox.gateway';
import { injectAdminUsersQuery } from '@data-access/queries/admin-users.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

import type { AdminMailboxRow } from '@saha-textile/contracts';

/** One person in the Access popup: Read, and Send on top of it. */
interface AccessLine {
	adminUserId: string;
	name: string;
	read: boolean;
	send: boolean;
}

/** Why a Google sign-in came back without a mailbox (`?error=` on the way back). */
const CONNECT_ERRORS: Readonly<Record<string, string>> = {
	cancelled: 'mailbox_connect_cancelled',
	expired: 'mailbox_connect_expired',
	not_on_domain: 'mailbox_connect_not_on_domain',
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
	private readonly users = injectAdminUsersQuery(() => ({ page: 1, pageSize: 200 }));
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

	/** The Access popup's mailbox and lines. */
	readonly accessFor = signal<AdminMailboxRow | null>(null);
	readonly accessLines = signal<AccessLine[]>([]);

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
				return 'badge bg-secondary';
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

	/** Opens the Access popup with every admin user and what each may do in this mailbox. */
	async openAccess(row: AdminMailboxRow, template: TemplateRef<unknown>) {
		const entries = await firstValueFrom(this.gateway.access(row.mailbox.id));
		const people = this.users.data()?.items ?? [];
		this.accessLines.set(
			people.map((user) => {
				const entry = entries.find((line) => line.adminUserId === user.id);
				return {
					adminUserId: user.id,
					name: user.displayName || user.email || user.username || user.id,
					read: Boolean(entry),
					send: Boolean(entry?.canSend),
				};
			}),
		);
		this.accessFor.set(row);
		this.modals.open(template, { centered: true, size: 'lg', windowClass: 'theme-modal' });
	}

	/** Send needs Read, so turning Send on turns Read on, and Read off turns Send off. */
	setAccess(adminUserId: string, field: 'read' | 'send', on: boolean) {
		this.accessLines.update((lines) =>
			lines.map((line) => {
				if (line.adminUserId !== adminUserId) return line;
				if (field === 'send') return { ...line, send: on, read: on || line.read };
				return { ...line, read: on, send: on && line.send };
			}),
		);
	}

	async saveAccess(modal: NgbModalRef) {
		const row = this.accessFor();
		if (!row) return;
		const entries = this.accessLines()
			.filter((line) => line.read)
			.map((line) => ({ adminUserId: line.adminUserId, canSend: line.send }));
		await firstValueFrom(this.gateway.saveAccess(row.mailbox.id, entries));
		modal.close();
		this.notifier.showSuccess(this.transloco.translate('mailbox_access_saved'));
		await this.reload();
	}

	private reload() {
		return this.queryClient.invalidateQueries({ queryKey: MAILBOXES_KEY });
	}
}
