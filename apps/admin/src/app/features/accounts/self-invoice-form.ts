import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { gstStateName } from '@saha-textile/core-domain/company';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { selfInvoiceDeadline, selfInvoiceTax } from '@saha-textile/core-domain/self-invoice';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { SELF_INVOICE_KEYS, SelfInvoicesGateway, selfInvoiceProblemKey } from '@core/accounts/self-invoices.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { parseRupees } from '@features/purchasing/shared/payment-popup';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { rupees } from './ledger-helpers';

import type { SelfInvoice, SelfInvoiceWrite } from '@saha-textile/contracts';

const daysFrom = (from: string, to: string) =>
	Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * D2 "Record a reverse-charge supply", as drawn: the 30-day banner (Rule 47A), only suppliers without a GSTIN, "What"
 * from the reverse-charge list for the day received, the tax we pay worked out as typed, and what Issue changes.
 */
@Component({
	selector: 'app-self-invoice-form',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './self-invoice-form.html',
})
export class SelfInvoiceFormPage {
	private readonly gateway = inject(SelfInvoicesGateway);
	private readonly router = inject(Router);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly today = istDay(new Date());
	readonly supplierId = signal('');
	readonly ruleKey = signal('');
	readonly forMonth = signal(this.today.slice(0, 7));
	readonly receivedOn = signal(this.today);
	readonly taxable = signal('');
	readonly busy = signal(false);
	private readonly version = signal<number | null>(null);
	readonly inr = (value: number) => rupees(Math.round(value * 100));

	readonly draft = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.get(this.id())),
		enabled: !!this.id(),
	}));
	readonly options = injectQuery(() => ({
		queryKey: SELF_INVOICE_KEYS.form(this.receivedOn()),
		queryFn: () => firstValueFrom(this.gateway.form(this.receivedOn())),
		enabled: !!this.receivedOn(),
	}));

	constructor() {
		effect(() => {
			const draft = this.draft.data();
			if (draft && this.version() === null) this.fill(draft);
		});
	}

	/** A draft opened again: its own values on the form. */
	fill(draft: SelfInvoice): void {
		this.supplierId.set(draft.supplierId);
		this.ruleKey.set(draft.rule.key);
		this.forMonth.set(draft.forMonth);
		this.receivedOn.set(draft.receivedOn);
		this.taxable.set(String(draft.taxableINR));
		this.version.set(draft.version);
	}

	readonly choice = computed(() => this.options.data()?.choices.find((c) => c.key === this.ruleKey()) ?? null);
	readonly supplier = computed(() => this.options.data()?.suppliers.find((s) => s.id === this.supplierId()) ?? null);
	readonly placeOfSupply = computed(() => this.options.data()?.placeOfSupply ?? '');
	readonly placeName = computed(() => {
		const code = this.placeOfSupply();
		return code ? `${gstStateName(code) ?? code} (${code})` : '—';
	});
	readonly interState = computed(() => !!this.supplier() && this.supplier()?.stateCode !== this.placeOfSupply());
	readonly taxableValue = computed(() => parseRupees(this.taxable()));
	readonly tax = computed(() =>
		selfInvoiceTax(this.taxableValue() ?? 0, this.choice()?.ratePercent ?? 0, this.interState()),
	);
	readonly halfRate = computed(() => (this.choice()?.ratePercent ?? 0) / 2);
	/** Rule 47A's clock: the last day, and the days left (negative once late). */
	readonly clock = computed(() => {
		const by = selfInvoiceDeadline(this.receivedOn());
		return { by, left: daysFrom(this.today, by) };
	});
	readonly canPost = computed(() => this.auth.permissions().includes('accounts.post'));
	readonly ready = computed(
		() =>
			this.canPost() &&
			!this.busy() &&
			!!this.supplier() &&
			!!this.choice() &&
			(this.taxableValue() ?? 0) > 0 &&
			!!this.forMonth() &&
			this.receivedOn() <= this.today,
	);

	day(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	private write(): SelfInvoiceWrite {
		return {
			supplierId: this.supplierId(),
			ruleKey: this.ruleKey(),
			forMonth: this.forMonth(),
			receivedOn: this.receivedOn(),
			taxableINR: this.taxableValue() ?? 0,
			version: this.version(),
		};
	}

	private async persist(): Promise<SelfInvoice> {
		const id = this.id();
		const saved = await firstValueFrom(
			id ? this.gateway.save(id, this.write()) : this.gateway.create(this.write()),
		);
		this.version.set(saved.version);
		return saved;
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const known = selfInvoiceProblemKey(message);
			this.notifier.showError(known ? this.transloco.translate(known.key, known.params) : message);
		} finally {
			this.busy.set(false);
		}
	}

	save(): Promise<void> {
		return this.run(async () => {
			const saved = await this.persist();
			this.notifier.showSuccess(this.transloco.translate('si_saved'));
			if (!this.id()) await this.router.navigate(['/accounts/self-invoices', saved.id, 'edit']);
		});
	}

	issue(): Promise<void> {
		return this.run(async () => {
			const saved = await this.persist();
			const issued = await firstValueFrom(this.gateway.issue(saved.id, saved.version));
			this.notifier.showSuccess(this.transloco.translate('si_issued', { number: issued.number }));
			await this.router.navigate(['/accounts/self-invoices', issued.id]);
		});
	}
}
