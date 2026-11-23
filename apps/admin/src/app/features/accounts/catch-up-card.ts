import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BooksCatchUpGateway, CATCH_UP_KEY } from '@core/accounts/books-catch-up.gateway';
import { booksWords } from '@core/accounts/books-refusal';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import type { BooksCatchUpResult, CatchUpKind } from '@saha-textile/contracts';

export const CATCH_UP_KINDS: readonly CatchUpKind[] = [
	'receipts',
	'purchaseEntries',
	'supplierPayments',
	'purchaseReturns',
	'returnRefunds',
	'businessReceipts',
];

/**
 * Accounts › Periods and locks › "Saved before the books took them" (Postings and Convert brief AP3, AP-D3): how many
 * documents of each kind have no voucher yet, and Post them, each on its own date, once. Ones the books can't take
 * (a locked month, a missing bank account) are listed with why; nothing is unlocked. Super admin only: anyone else
 * is told so in place.
 */
@Component({
	selector: 'app-catch-up-card',
	imports: [TranslocoModule],
	templateUrl: './catch-up-card.html',
})
export class CatchUpCard {
	private readonly gateway = inject(BooksCatchUpGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly kinds = CATCH_UP_KINDS;
	readonly busy = signal(false);
	readonly result = signal<BooksCatchUpResult | null>(null);
	readonly waiting = injectQuery(() => ({
		queryKey: CATCH_UP_KEY,
		queryFn: () => firstValueFrom(this.gateway.summary()),
		retry: false,
	}));

	private readonly t = (key: string, params: Record<string, string> = {}) => this.transloco.translate(key, params);

	/** Why the card can't show the counts: only the super admin may, or the read failed. */
	readonly refused = computed(() => {
		const error = this.waiting.error();
		if (!error) return null;
		const words: Record<string, string> = {
			catch_up_super_admin_only: 'cu_super_admin_only',
			books_not_set_up: 'cu_books_not_set_up',
		};
		return this.t(words[apiProblem(error, '')] ?? 'cu_failed');
	});
	readonly total = computed(() =>
		this.kinds.reduce((sum, kind) => sum + (this.waiting.data()?.waiting[kind] ?? 0), 0),
	);
	/** "Receipts 14 · Purchase entries 6 · …", leaving out kinds with none. */
	readonly line = computed(() =>
		this.kinds
			.map((kind) => ({ kind, count: this.waiting.data()?.waiting[kind] ?? 0 }))
			.filter((row) => row.count > 0)
			.map((row) => `${this.t(`cu_kind_${row.kind}`)} ${row.count}`)
			.join(' · '),
	);
	readonly day = shortDate;

	/** A skipped document's reason, in words when the books gave a code. */
	reason(code: string): string {
		return code === 'receipt_method_unknown' ? this.t('cu_method_unknown') : booksWords(code, this.t);
	}

	async post(): Promise<void> {
		this.busy.set(true);
		try {
			const done = await firstValueFrom(this.gateway.run());
			this.result.set(done);
			const posted = this.kinds.reduce((sum, kind) => sum + done.posted[kind], 0);
			await this.queryClient.invalidateQueries({ queryKey: ['accounts'] });
			this.notifier.showSuccess(this.t('cu_done', { count: String(posted) }));
		} catch (error) {
			this.notifier.showError(booksWords(apiProblem(error, this.t('cu_failed')), this.t));
		} finally {
			this.busy.set(false);
		}
	}
}
