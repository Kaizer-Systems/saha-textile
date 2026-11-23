import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem, rupees } from '@core/purchasing/purchasing-format';

import type { MessageOutboxStatus, Order, PaymentRequest, PaymentRequestMessagePreview } from '@saha-textile/contracts';

export type SendChannel = 'sms' | 'email';

/** What the page says after a send: sent, queued, or why it didn't go. */
export interface SendOutcome {
	status: MessageOutboxStatus;
}

/**
 * Send as SMS / Send as email (brief pr01, pr02; owner message 18): our own MSG91 message about a
 * payment request, shown exactly before it goes and sent only because staff pressed the button. The
 * SMS goes only to Indian mobile numbers (DLT); either channel follows Settings › Communications.
 * The server builds the text and decides whether it can go; this popup shows its answer.
 */
@Component({
	selector: 'app-order-send-popup',
	template: `
		<div class="modal-header">
			<h2 id="order_send_popup_title">
				{{ (channel() === 'sms' ? 'ord_send_sms_title' : 'ord_send_email_title') | transloco }}
			</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body">
			<p class="small text-muted">
				{{ (channel() === 'sms' ? 'ord_send_sms_intro' : 'ord_send_email_intro') | transloco }}
			</p>
			@if (preview(); as message) {
				<ul class="list-unstyled small mt-3 mb-0">
					<li class="mb-1">
						<span class="text-muted">{{ 'ord_send_to' | transloco }}:</span>
						{{ toLine() }}
					</li>
					@if (channel() === 'sms') {
						<li class="mb-1">
							<span class="text-muted">{{ 'ord_send_template' | transloco }}:</span>
							{{ 'ord_send_template_dlt' | transloco }}
						</li>
					} @else {
						<li class="mb-1">
							<span class="text-muted">{{ 'ord_send_subject' | transloco }}:</span>
							{{ message.text }}
						</li>
						<li class="mb-1">
							<span class="text-muted">{{ 'ord_send_shows' | transloco }}:</span>
							{{ 'ord_send_shows_line' | transloco: { amount: amount() } }}
						</li>
					}
				</ul>
				@if (channel() === 'sms') {
					<div class="bg-light small mt-3 rounded border p-3">
						<div class="text-muted mb-1">{{ 'ord_send_sms_from' | transloco }}</div>
						<div class="text-break">{{ message.text }}</div>
					</div>
				}
				@if (message.unavailable) {
					<div
						class="alert alert-warning d-flex align-items-start mt-3 mb-0 gap-2"
						role="alert"
					>
						<i class="ri-error-warning-line mt-1"></i>
						<div>{{ 'ord_send_unavailable_' + message.unavailable | transloco }}</div>
					</div>
				}
			} @else if (!error()) {
				<p class="small text-muted mb-0">{{ 'ord_send_loading' | transloco }}</p>
			}
			@if (error(); as problem) {
				<div
					class="alert alert-warning d-flex align-items-start mt-3 mb-0 gap-2"
					role="alert"
				>
					<i class="ri-error-warning-line mt-1"></i>
					<div>{{ problem }}</div>
				</div>
			}
		</div>
		<div class="modal-footer">
			<div class="left-part"></div>
			<div class="right-part">
				<button
					type="button"
					class="btn btn-outline"
					(click)="modal.dismiss()"
				>
					{{ 'cancel' | transloco }}
				</button>
				<button
					type="button"
					class="btn btn-theme"
					[disabled]="!ready() || busy()"
					(click)="send()"
				>
					<i [class]="(channel() === 'sms' ? 'ri-message-2-line' : 'ri-mail-send-line') + ' me-1'"></i>
					{{ (channel() === 'sms' ? 'ord_send_sms_button' : 'ord_send_email_button') | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class OrderSendPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly order = signal<Order | null>(null);
	readonly request = signal<PaymentRequest | null>(null);
	readonly channel = signal<SendChannel>('sms');
	readonly preview = signal<PaymentRequestMessagePreview | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly ready = computed(() => !!this.preview() && !this.preview()?.unavailable);

	/** pr01: "+91 98311 22334 (Kavita Iyer, billing contact)"; pr02: the email address alone. */
	readonly toLine = computed(() => {
		const to = this.preview()?.to ?? '—';
		if (this.channel() === 'email') return to;
		const name = this.order()?.buyer?.name;
		return name ? this.transloco.translate('ord_send_to_billing', { to, name }) : to;
	});
	readonly amount = computed(() => rupees(this.request()?.amountINR ?? 0));

	async start(order: Order, request: PaymentRequest, channel: SendChannel): Promise<void> {
		this.order.set(order);
		this.request.set(request);
		this.channel.set(channel);
		try {
			this.preview.set(await firstValueFrom(this.gateway.requestMessage(order.id, request.id, channel)));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	async send(): Promise<void> {
		const order = this.order();
		const request = this.request();
		if (!order || !request || !this.ready()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const out = await firstValueFrom(this.gateway.sendRequestMessage(order.id, request.id, this.channel()));
			this.modal.close({ status: out.status } satisfies SendOutcome);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
