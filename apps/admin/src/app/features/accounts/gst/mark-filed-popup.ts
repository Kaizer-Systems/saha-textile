import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { GST_KEYS } from '@core/accounts/gst-returns.gateway';
import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';

import { gstProblem } from './gst-returns-page';

import type { GstDraftType, VoucherAttachment } from '@saha-textile/contracts';

export interface MarkFiledStart {
	gstRegistrationId: string;
	gstin: string;
	returnType: GstDraftType;
	month: string;
	monthName: string;
}

const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * G8 Mark filed and lock, as a pop-up any return page opens: the ARN and day from the portal and its acknowledgement;
 * what it changes is listed (the month's books lock for the GSTIN, the filed figures are kept, the edit log). Closes
 * with true once saved.
 */
@Component({
	selector: 'app-mark-filed-popup',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './mark-filed-popup.html',
})
export class MarkFiledPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly ledger = inject(LedgerGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly about = signal<MarkFiledStart | null>(null);
	readonly arn = signal('');
	readonly filedOn = signal(today());
	readonly acknowledgement = signal<VoucherAttachment | null>(null);
	readonly busy = signal(false);

	start(about: MarkFiledStart): void {
		this.about.set(about);
	}

	/** GSTR-1 locks the month's sales; GSTR-3B its sales and purchases. */
	lockBody(): string {
		return this.about()?.returnType === 'GSTR-1' ? 'gstr1_change_lock_body' : 'accounts_gst_change_lock_body';
	}

	async attachAck(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'accounts_ack_file',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.acknowledgement.set({ assetId: picked[0].assetId, name: picked[0].name });
	}

	async save(): Promise<void> {
		const about = this.about();
		if (!about) return;
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.ledger.markFiled({
					gstRegistrationId: about.gstRegistrationId,
					returnType: about.returnType,
					month: about.month,
					arn: this.arn(),
					filedOn: this.filedOn(),
					acknowledgement: this.acknowledgement(),
				}),
			);
			await this.queries.invalidateQueries({ queryKey: LEDGER_KEYS.periods });
			await this.queries.invalidateQueries({ queryKey: GST_KEYS.all });
			this.notifier.showSuccess(this.transloco.translate('accounts_gst_filed_saved'));
			this.modal.close(true);
		} catch (error) {
			this.notifier.showError(this.transloco.translate(gstProblem(error)));
		} finally {
			this.busy.set(false);
		}
	}
}
