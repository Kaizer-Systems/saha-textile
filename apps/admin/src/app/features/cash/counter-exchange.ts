import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { COUNTER_KEYS, CounterGateway, counterProblemKey } from '@core/counter/counter.gateway';
import { money } from '@core/orders/order-format';
import { apiProblem, openPdf, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { AdminCartLine, CounterExchangeWrite, CounterPaymentMethod, ReturnReason } from '@saha-textile/contracts';

/** What can come back from the bill, with the screen's own choices. */
interface BackRow {
	lineId: string;
	sku: string;
	title: string;
	left: number;
	unitPriceINR: number;
	returnable: boolean;
}

/** An item scanned to go out instead. */
interface OutRow {
	key: string;
	productId: string;
	variationId: string | null;
	sku: string;
	title: string;
	quantity: number;
}

export const EXCHANGE_REASONS: readonly ReturnReason[] = [
	'size_or_fit',
	'changed_mind',
	'not_as_described',
	'wrong_item',
	'damaged_on_arrival',
	'other',
];
const round2 = (value: number) => Math.round(value * 100) / 100;
let counter = 0;

/**
 * Exchange at the counter (accounts brief P3): find the bill, pick what comes back and where it goes, scan what goes
 * out instead. The credit note, the new tax invoice and the cash move together; money given back is cash from the
 * till, money the buyer pays may be cash, UPI or card.
 */
@Component({
	selector: 'app-counter-exchange',
	templateUrl: './counter-exchange.html',
	imports: [TranslocoModule, FormsModule, PageWrapper],
})
export class CounterExchangePage {
	private readonly gateway = inject(CounterGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);

	readonly orderId = toSignal(this.route.paramMap.pipe(map((p) => p.get('orderId'))), { initialValue: null });
	readonly bill = injectQuery(() => ({
		queryKey: COUNTER_KEYS.bill(this.orderId() ?? ''),
		queryFn: () => firstValueFrom(this.gateway.bill(this.orderId() as string)),
		enabled: !!this.orderId(),
	}));
	readonly reasons = EXCHANGE_REASONS;

	readonly number = signal('');
	readonly back = signal<Record<string, { quantity: number; goes: 'stock' | 'damaged' }>>({});
	readonly out = signal<OutRow[]>([]);
	readonly code = signal('');
	readonly reason = signal<ReturnReason>('size_or_fit');
	readonly settle = signal<CounterPaymentMethod>('cash');
	readonly reference = signal('');
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);

	readonly rows = computed<BackRow[]>(() =>
		(this.bill.data()?.lines ?? []).map((line) => ({
			lineId: line.lineId,
			sku: line.sku,
			title: line.title,
			left: line.bought - line.returnedBefore,
			unitPriceINR: line.unitPriceINR,
			returnable: line.returnable && line.bought > line.returnedBefore,
		})),
	);
	readonly backINR = computed(() =>
		round2(this.rows().reduce((sum, row) => sum + (this.back()[row.lineId]?.quantity ?? 0) * row.unitPriceINR, 0)),
	);
	readonly quote = injectQuery(() => {
		const bill = this.bill.data();
		const lines = this.out().map((row) => ({
			productId: row.productId,
			variationId: row.variationId,
			quantity: row.quantity,
			scanned: true,
		}));
		const write = bill && lines.length ? { locationId: bill.locationId, lines } : null;
		return {
			queryKey: COUNTER_KEYS.quote(write),
			queryFn: () => firstValueFrom(this.gateway.quote(write as never)),
			enabled: !!write,
		};
	});
	readonly outINR = computed(() => (this.out().length ? (this.quote.data()?.totalINR ?? 0) : 0));
	/** Positive: the buyer pays it; negative: given back in cash. */
	readonly differenceINR = computed(() => round2(this.outINR() - this.backINR()));
	readonly canExchange = computed(
		() =>
			!this.busy() &&
			this.backINR() > 0 &&
			(!this.out().length || (!this.quote.isFetching() && !!this.quote.data()?.lines.length)) &&
			(this.differenceINR() <= 0 || this.settle() === 'cash' || this.reference().trim().length > 0),
	);

	rupees(amount: number): string {
		return money(amount, 'INR');
	}

	date(value: string | null): string {
		return shortDate(value);
	}

	/** Find a bill by its order number or tax invoice number. */
	async find(): Promise<void> {
		const typed = this.number().trim();
		if (!typed) return;
		this.problem.set(null);
		try {
			const { orderId } = await firstValueFrom(this.gateway.find(typed));
			await this.router.navigate(['/cash/exchange', orderId]);
		} catch (error) {
			this.problem.set(counterProblemKey(apiProblem(error, 'cash_failed')));
		}
	}

	setBack(row: BackRow, quantity: number): void {
		const current = this.back()[row.lineId];
		const clamped = Math.max(0, Math.min(row.left, Math.floor(Number(quantity) || 0)));
		this.back.update((all) => ({ ...all, [row.lineId]: { quantity: clamped, goes: current?.goes ?? 'stock' } }));
	}

	setGoes(row: BackRow, goes: 'stock' | 'damaged'): void {
		const current = this.back()[row.lineId];
		this.back.update((all) => ({ ...all, [row.lineId]: { quantity: current?.quantity ?? 0, goes } }));
	}

	/** Scan what goes out instead; the same item again adds to its line. */
	async scan(): Promise<void> {
		const code = this.code().trim();
		if (!code) return;
		this.problem.set(null);
		try {
			const found = await firstValueFrom(this.gateway.scan(code));
			const same = this.out().find((r) => r.productId === found.productId && r.variationId === found.variationId);
			const step = found.soldBy === 'metre' ? 10 : 1;
			if (same)
				this.out.update((rows) => rows.map((r) => (r === same ? { ...r, quantity: r.quantity + step } : r)));
			else
				this.out.update((rows) => [
					...rows,
					{
						key: `x${++counter}`,
						productId: found.productId,
						variationId: found.variationId,
						sku: found.sku,
						title: found.title,
						quantity: step,
					},
				]);
			this.code.set('');
		} catch (error) {
			this.problem.set(counterProblemKey(apiProblem(error, 'counter_code_unknown')));
		}
	}

	removeOut(key: string): void {
		this.out.update((rows) => rows.filter((r) => r.key !== key));
	}

	/** The price of a line going out, as the quote priced it. */
	outValue(index: number): number | null {
		const lines = this.quote.data()?.lines ?? [];
		return lines.length === this.out().length && index < lines.length
			? (lines[index] as AdminCartLine).lineTotalINR
			: null;
	}

	/** The new sale's invoice on the roll; the exchange stands if the print fails. */
	private async printSale(orderId: string): Promise<void> {
		try {
			openPdf(await firstValueFrom(this.gateway.print(orderId, 'roll80')));
		} catch {
			this.notifier.showError(this.transloco.translate('counter_print_failed'));
		}
	}

	async exchange(): Promise<void> {
		const orderId = this.orderId();
		if (!orderId || !this.canExchange()) return;
		const write: CounterExchangeWrite = {
			back: this.rows().flatMap((row) => {
				const pick = this.back()[row.lineId];
				return pick && pick.quantity > 0
					? [{ lineId: row.lineId, quantity: pick.quantity, goes: pick.goes }]
					: [];
			}),
			out: this.out().map((row) => ({
				productId: row.productId,
				variationId: row.variationId,
				quantity: row.quantity,
				scanned: true,
			})),
			reason: this.reason(),
			settle: this.differenceINR() > 0 ? this.settle() : 'cash',
			reference: this.reference().trim(),
			expectedBackINR: this.backINR(),
			expectedOutINR: this.outINR(),
		};
		this.busy.set(true);
		this.problem.set(null);
		try {
			const done = await firstValueFrom(this.gateway.exchange(orderId, write));
			this.notifier.showSuccess(
				this.transloco.translate('counter_exchanged', {
					note: done.creditNoteNumber,
					invoice: done.sale?.invoiceNumber ?? '—',
				}),
			);
			if (done.sale) await this.printSale(done.sale.orderId);
			this.back.set({});
			this.out.set([]);
			await this.router.navigate(['/cash/exchange']);
		} catch (error) {
			this.problem.set(counterProblemKey(apiProblem(error, 'cash_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
