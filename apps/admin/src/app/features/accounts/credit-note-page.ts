import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { gstStateName } from '@saha-textile/core-domain/company';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { RETURN_KEYS, ReturnsGateway, returnProblemKey } from '@core/accounts/returns.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { rupees } from './ledger-helpers';

import type { CreditNote, CreditNoteCancelChecks } from '@saha-textile/contracts';

/**
 * A credit note (accounts brief B4, B5, B8, B9 as drawn): a draft's lines from its invoice with Save and Issue, and
 * what Issue changes; an issued note's prints, Cancel (super admin, month open) or a debit note when it can't be.
 */
@Component({
	selector: 'app-credit-note-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './credit-note-page.html',
})
export class CreditNotePage {
	private readonly gateway = inject(ReturnsGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly busy = signal(false);
	readonly quantities = signal<Record<string, number>>({});
	readonly reason = signal('');
	readonly checks = signal<CreditNoteCancelChecks | null>(null);
	readonly inr = (value: number) => rupees(Math.round(value * 100));
	private modal: NgbModalRef | null = null;

	readonly note = injectQuery(() => ({
		queryKey: RETURN_KEYS.creditNote(this.id()),
		queryFn: () => firstValueFrom(this.gateway.creditNote(this.id())),
		enabled: !!this.id(),
	}));
	readonly draft = computed(() => this.note.data()?.status === 'draft');
	readonly goodsKind = computed(() => this.note.data()?.kind !== 'price_adjustment');
	readonly ratePercent = computed(() => this.note.data()?.lines.find((l) => !l.delivery)?.ratePercent ?? 0);

	state(code: string): string {
		return code === '96'
			? this.transloco.translate('inv_outside_india')
			: `${gstStateName(code) ?? code} (${code})`;
	}

	day(iso: string): string {
		return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}

	quantity(lineId: string, current: number): number {
		return this.quantities()[lineId] ?? current;
	}

	setQuantity(lineId: string, value: number, max: number): void {
		this.quantities.update((all) => ({
			...all,
			[lineId]: Math.min(max, Math.max(0, Math.floor(Number(value) || 0))),
		}));
	}

	private async run(work: () => Promise<void>, done: string | null = null): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			this.modal?.close();
			await this.queryClient.invalidateQueries({ queryKey: RETURN_KEYS.creditNote(this.id()) });
			if (done) this.notifier.showSuccess(this.transloco.translate(done));
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const problem = returnProblemKey(message);
			this.notifier.showError(problem ? this.transloco.translate(problem.key, problem.params) : message);
		} finally {
			this.busy.set(false);
		}
	}

	save(note: CreditNote): Promise<void> {
		const lines = Object.entries(this.quantities()).map(([lineId, quantity]) => ({ lineId, quantity }));
		return this.run(async () => {
			await firstValueFrom(this.gateway.saveDraft(note.id, { version: note.version, lines }));
			this.quantities.set({});
		}, 'cn_saved');
	}

	remove(note: CreditNote): Promise<void> {
		return this.run(async () => {
			await firstValueFrom(this.gateway.deleteDraft(note.id));
			await this.router.navigate(['/order/details', note.orderId]);
		}, 'cn_deleted');
	}

	issue(note: CreditNote): Promise<void> {
		return this.run(
			async () => void (await firstValueFrom(this.gateway.issue(note.id, note.version))),
			'cn_issued',
		);
	}

	print(note: CreditNote): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.creditNotePdf(note.id))));
	}

	printDebit(id: string): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.debitNotePdf(id))));
	}

	/** B8 when the month is open and the person may; B9 otherwise. */
	async openCancel(
		cancelModal: TemplateRef<unknown>,
		blockedModal: TemplateRef<unknown>,
		note: CreditNote,
	): Promise<void> {
		const checks = await firstValueFrom(this.gateway.cancelChecks(note.id));
		this.checks.set(checks);
		this.reason.set('');
		this.modal = this.modals.open(checks.monthFiled || checks.booksClosed ? blockedModal : cancelModal, {
			centered: true,
			size: 'lg',
		});
	}

	openDebit(debitModal: TemplateRef<unknown>): void {
		this.modal?.close();
		this.reason.set('');
		this.modal = this.modals.open(debitModal, { centered: true });
	}

	cancel(note: CreditNote): Promise<void> {
		return this.run(
			async () => void (await firstValueFrom(this.gateway.cancel(note.id, this.reason()))),
			'cn_cancelled',
		);
	}

	debit(note: CreditNote): Promise<void> {
		return this.run(
			async () => void (await firstValueFrom(this.gateway.debitNote(note.id, this.reason()))),
			'cn_debit_made',
		);
	}
}
