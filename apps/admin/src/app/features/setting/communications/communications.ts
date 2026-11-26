import { HttpErrorResponse } from '@angular/common/http';
import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import {
	AdminCommunicationsGateway,
	type CommunicationSwitchWrite,
} from '@core/admin-communications/admin-communications.gateway';
import {
	COMMUNICATIONS_QUERY_KEY,
	injectCommunicationSettingsQuery,
} from '@data-access/queries/admin-communications.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type {
	CommunicationChannel,
	CommunicationGroup,
	CommunicationSettingsResponse,
	CommunicationUseView,
} from '@saha-textile/contracts';

interface CellRef {
	use: CommunicationUseView;
	channel: CommunicationChannel;
}

/** The API's refusal codes (domain refusals), each with the sentence the page shows for it. */
const REFUSAL_KEYS: Readonly<Record<string, string>> = {
	locked: 'comm_error_locked',
	unavailable: 'comm_error_unavailable',
	email_required: 'comm_error_email_required',
	phone_channel_required: 'comm_error_phone_channel_required',
};

/**
 * Settings › Communications (super admin): which channels carry each message.
 *
 * Built only from existing pieces (DEC-UI-REUSE): the page wrapper and the switch table of
 * Notification settings, Remix icons with Bootstrap text colours, and the password form of the
 * idle-lock modal. The list and its state come from the API, which enforces every rule again:
 * switching on a cell with a warning asks for the password (never the PIN); red cells never move.
 */
@Component({
	selector: 'app-communications-settings',
	templateUrl: './communications.html',
	imports: [PageWrapper, ReactiveFormsModule, TranslocoModule, Button, FormFields, HasPermissionDirective],
})
export class CommunicationsSettings {
	private readonly modalService = inject(NgbModal);
	private readonly gateway = inject(AdminCommunicationsGateway);
	private readonly queryClient = injectQueryClient();
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly settingsQuery = injectCommunicationSettingsQuery();
	readonly channels = computed(() => this.settingsQuery.data()?.channels ?? []);
	readonly groups = computed(() => this.settingsQuery.data()?.groups ?? []);

	readonly confirmTpl = viewChild<TemplateRef<unknown>>('confirmChannelModal');

	readonly pending = signal<CellRef | null>(null);
	readonly error = signal<string | null>(null);
	readonly saving = signal(false);
	readonly passwordForm = new FormGroup({
		password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
	});

	private ref: NgbModalRef | null = null;

	private readonly changeMutation = injectMutation(() => ({
		mutationFn: (input: CommunicationSwitchWrite) => lastValueFrom(this.gateway.change(input)),
		onSuccess: (table: CommunicationSettingsResponse) => {
			this.queryClient.setQueryData(COMMUNICATIONS_QUERY_KEY, table);
		},
	}));

	usesIn(group: CommunicationGroup): CommunicationUseView[] {
		return (this.settingsQuery.data()?.items ?? []).filter((use) => use.group === group);
	}

	onToggle(use: CommunicationUseView, channel: CommunicationChannel, event: Event): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;
		const on = input.checked;
		// The switch shows the stored state until the server agrees.
		input.checked = use.cells[channel].on;
		if (on && use.cells[channel].risk === 'warning') {
			this.openConfirm({ use, channel });
			return;
		}
		this.changeMutation.mutate(
			{ use: use.key, channel, on },
			{ onError: (error) => this.notifier.showError(this.transloco.translate(this.refusalKey(error))) },
		);
	}

	private openConfirm(target: CellRef): void {
		const tpl = this.confirmTpl();
		if (!tpl) return;
		this.pending.set(target);
		this.error.set(null);
		this.passwordForm.reset();
		this.ref = this.modalService.open(tpl, {
			ariaLabelledBy: 'confirm-channel-title',
			centered: true,
			windowClass: 'theme-modal text-center',
		});
		// Closed or dismissed, the modal ends the same way; a dismissal is not an error.
		const closed = (): void => {
			this.ref = null;
			this.pending.set(null);
		};
		this.ref.result.then(closed, closed);
	}

	confirm(): void {
		const target = this.pending();
		if (!target || this.saving()) return;
		if (this.passwordForm.invalid) {
			this.passwordForm.markAllAsTouched();
			this.error.set('password_is_required');
			return;
		}
		this.saving.set(true);
		this.error.set(null);
		this.changeMutation.mutate(
			{
				use: target.use.key,
				channel: target.channel,
				on: true,
				currentPassword: this.passwordForm.getRawValue().password,
			},
			{
				onSuccess: () => this.ref?.close(),
				// A wrong password stays in the popup; the session is fine and is never signed out.
				onError: (error) => this.error.set(this.refusalKey(error)),
				onSettled: () => this.saving.set(false),
			},
		);
	}

	cancel(): void {
		this.ref?.dismiss();
	}

	/** 403 is the password proof failing; a domain refusal names the rule it broke. */
	private refusalKey(error: unknown): string {
		if (!(error instanceof HttpErrorResponse)) return 'comm_error_not_saved';
		if (error.status === 403) return 'comm_error_invalid_password';
		const code: unknown = error.error?.error?.issues?.[0]?.code;
		return (typeof code === 'string' && REFUSAL_KEYS[code]) || 'comm_error_not_saved';
	}
}
