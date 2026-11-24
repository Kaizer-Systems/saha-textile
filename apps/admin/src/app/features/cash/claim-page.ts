import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { CASH_KEYS, CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { CLAIM_PILL } from './claims-list';

import type { ClaimPayBack } from '@saha-textile/contracts';

/**
 * O12: one expense claim, its head, amount, what for and bill; a manager approves it with how it is paid back (from a
 * petty cash box, with the next salary, or by bank) or rejects it with why. The card on the right says what approval
 * does to the books and to payroll.
 */
@Component({
	selector: 'app-cash-claim-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './claim-page.html',
})
export class CashClaimPage {
	private readonly gateway = inject(CashGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	// The route is always ':id'.
	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') as string)), {
		initialValue: '',
	});
	readonly ways: ClaimPayBack[] = ['petty', 'salary', 'bank'];
	readonly pill = CLAIM_PILL;
	readonly inr = (paise: number) => rupees(paise);
	readonly payBack = signal<ClaimPayBack>('salary');
	readonly boxId = signal('');
	readonly bankId = signal('');
	readonly reason = signal('');
	readonly rejecting = signal(false);
	readonly busy = signal(false);

	readonly claim = injectQuery(() => ({
		queryKey: CASH_KEYS.claim(this.id()),
		queryFn: () => firstValueFrom(this.gateway.claim(this.id())),
		enabled: !!this.id(),
	}));
	readonly choices = injectQuery(() => ({
		queryKey: CASH_KEYS.choices,
		queryFn: () => firstValueFrom(this.gateway.choices()),
	}));
	/** Petty boxes at the claim's location. */
	readonly boxes = computed(() =>
		(this.choices.data()?.boxes ?? []).filter((b) => b.locationId === this.claim.data()?.locationId),
	);
	readonly canDecide = computed(() => {
		const claim = this.claim.data();
		const choices = this.choices.data();
		return (
			!!claim &&
			!!choices?.manager &&
			claim.status === 'waiting' &&
			(claim.staffUserId !== choices.userId || choices.superAdmin)
		);
	});
	readonly ready = computed(() => {
		if (this.payBack() === 'petty') return !!this.boxId();
		if (this.payBack() === 'bank') return !!this.bankId();
		return true;
	});

	async approve(): Promise<void> {
		const claim = this.claim.data();
		if (!claim) return;
		await this.decide(() =>
			this.gateway.decide(claim.id, {
				decision: 'approve',
				payBack: this.payBack(),
				payBoxId: this.payBack() === 'petty' ? this.boxId() : null,
				bankLedgerId: this.payBack() === 'bank' ? this.bankId() : null,
				version: claim.version,
			}),
		);
	}

	async reject(): Promise<void> {
		const claim = this.claim.data();
		if (!claim || !this.reason().trim()) return;
		await this.decide(() =>
			this.gateway.decide(claim.id, { decision: 'reject', reason: this.reason().trim(), version: claim.version }),
		);
	}

	private async decide(step: () => import('rxjs').Observable<unknown>): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(step());
			this.rejecting.set(false);
			this.notifier.showSuccess(this.transloco.translate('cash_claim_decided'));
			await this.queryClient.invalidateQueries({ queryKey: CASH_KEYS.all });
		} catch (error) {
			const problem = cashProblemKey(apiProblem(error, 'cash_failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
		} finally {
			this.busy.set(false);
		}
	}
}
