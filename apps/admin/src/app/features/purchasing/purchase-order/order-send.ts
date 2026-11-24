import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { injectBrandQuery } from '@core/brand/brand.gateway';
import { injectInboxSummaryQuery } from '@core/mailboxes/mailbox.gateway';
import { apiIssues, apiProblem, saveBlob, shortDate } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { translateCount } from '@shared/pipes/language.pipes';

import { linesQuantity } from '../shared/purchasing-labels';

import type { PurchaseOrder } from '@saha-textile/contracts';

/** Email addresses typed with commas or spaces between them. */
export function splitAddresses(text: string): string[] {
	return text
		.split(/[,;\s]+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The send-as addresses of every mailbox this person may send from (Settings › Mailboxes). */
export interface SendFrom {
	mailboxId: string;
	address: string;
	label: string;
}

/**
 * Send to the supplier (po03): email with the order PDF attached, through a mailbox connected in
 * Settings › Mailboxes so replies land in Inbox; or download the PDF to send another way. Either
 * way the order becomes Sent and records who sent it and how.
 */
@Component({
	selector: 'app-order-send',
	templateUrl: './order-send.html',
	imports: [FormsModule, TranslocoModule],
})
export class OrderSend {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly mailboxes = injectInboxSummaryQuery();
	private readonly brand = injectBrandQuery();

	readonly order = signal<PurchaseOrder | null>(null);
	readonly via = signal<'email' | 'pdf'>('email');
	readonly from = signal('');
	readonly to = signal('');
	readonly subject = signal('');
	readonly message = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly fieldErrors = signal<Record<string, string>>({});

	readonly senders = computed<SendFrom[]>(() =>
		(this.mailboxes.data() ?? [])
			.filter((box) => box.canSend && box.status === 'connected')
			.flatMap((box) =>
				(box.sendAs.length
					? box.sendAs
					: [{ address: box.address, displayName: '', isPrimary: true, signature: '' }]
				).map((alias) => ({
					mailboxId: box.mailboxId,
					address: alias.address,
					label: alias.displayName ? `${alias.displayName} <${alias.address}>` : alias.address,
				})),
			),
	);
	readonly recipients = computed(() => splitAddresses(this.to()));
	readonly badRecipients = computed(() => this.recipients().filter((address) => !EMAIL.test(address)));
	readonly canSend = computed(() => {
		if (this.busy()) return false;
		if (this.via() === 'pdf') return true;
		return !!this.from() && this.recipients().length > 0 && this.badRecipients().length === 0;
	});
	readonly fileName = computed(() => `${(this.order()?.number ?? 'order').replace(/\//g, '-')}.pdf`);

	start(order: PurchaseOrder, supplierEmail: string | null): void {
		this.order.set(order);
		this.to.set(supplierEmail ?? '');
		// The shop's name from the Brand Kit (white-label): without one the email simply leaves it out.
		const shop = this.brand.data()?.shopName?.trim() ?? '';
		this.subject.set(
			this.transloco.translate(shop ? 'po_email_subject' : 'po_email_subject_plain', {
				number: order.number,
				shop,
			}),
		);
		const what = linesQuantity(
			order.lines,
			(key, n) => translateCount(this.transloco, key, n),
			(key, params) => this.transloco.translate(key, params),
			this.transloco.getActiveLang(),
		);
		this.message.set(
			this.transloco.translate(shop ? 'po_email_body' : 'po_email_body_plain', {
				number: order.number,
				what,
				date: shortDate(order.expectedBy),
				shop,
			}),
		);
		const first = this.senders()[0];
		if (first) this.from.set(`${first.mailboxId}|${first.address}`);
	}

	/** The mailbox list may arrive after the popup opens: pick its first address then. */
	ensureFrom(): void {
		// Never-run check removed: the first sender was read twice; once is enough.
		const first = this.senders()[0];
		if (!this.from() && first) this.from.set(`${first.mailboxId}|${first.address}`);
	}

	async send(): Promise<void> {
		const order = this.order();
		if (!order || !this.canSend()) return;
		this.busy.set(true);
		this.error.set(null);
		this.fieldErrors.set({});
		try {
			if (this.via() === 'pdf') {
				const blob = await firstValueFrom(this.gateway.orderPdf(order.id));
				saveBlob(this.fileName(), blob);
				const sent = await firstValueFrom(
					this.gateway.sendOrder(order.id, { via: 'pdf', to: [], subject: '', message: '' }),
				);
				this.modal.close(sent);
				return;
			}
			const [mailboxId, address] = this.from().split('|');
			const sent = await firstValueFrom(
				this.gateway.sendOrder(order.id, {
					via: 'email',
					mailboxId,
					from: address,
					to: this.recipients(),
					subject: this.subject().trim(),
					message: this.message().trim(),
				}),
			);
			this.modal.close(sent);
		} catch (error) {
			const fields: Record<string, string> = {};
			for (const issue of apiIssues(error)) if (issue.target) fields[issue.target] = issue.message;
			this.fieldErrors.set(fields);
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
