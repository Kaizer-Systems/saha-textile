import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';

import { statementProblem } from './statement-import';

import type { BankLine, BookEntry } from '@saha-textile/contracts';

/** What the reconcile page hands the popup. */
export interface LinkStart {
	bankAccountId: string;
	line: Pick<BankLine, 'id' | 'date' | 'description' | 'inPaise' | 'outPaise'>;
	/** The suggestion just turned down to free the line, in words; null when there was none. */
	removed: string | null;
}

/**
 * Link a statement line elsewhere (accounts brief BA8): find what it pays among the account's entries not matched yet,
 * pick one or several that come to the line's amount, and link. Every link is in the edit log.
 */
@Component({
	selector: 'app-link-popup',
	templateUrl: './link-popup.html',
	imports: [TranslocoModule, FormsModule],
})
export class LinkPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(BanksGateway);

	readonly start$ = signal<LinkStart | null>(null);
	readonly q = signal('');
	readonly picked = signal<ReadonlySet<string>>(new Set());
	readonly busy = signal(false);
	readonly problem = signal<{ key: string; params: Record<string, string> } | null>(null);

	readonly found = injectQuery(() => {
		const id = this.start$()?.bankAccountId ?? '';
		const q = this.q();
		return {
			queryKey: BANK_KEYS.entries(id, q),
			queryFn: () => firstValueFrom(this.gateway.entries(id, q)),
			enabled: !!id,
		};
	});
	/** The line's money, signed as entries are: in positive, out negative. */
	readonly lineNet = computed(() => {
		const line = this.start$()?.line;
		return line ? line.inPaise - line.outPaise : 0;
	});
	readonly pickedNet = computed(() =>
		(this.found.data() ?? [])
			.filter((entry) => this.picked().has(entry.voucherId))
			.reduce((sum, entry) => sum + entry.inPaise - entry.outPaise, 0),
	);
	readonly ready = computed(() => this.picked().size > 0 && this.pickedNet() === this.lineNet());

	start(start: LinkStart): void {
		this.start$.set(start);
	}

	toggle(entry: BookEntry): void {
		this.picked.update((picked) => {
			const next = new Set(picked);
			if (next.has(entry.voucherId)) next.delete(entry.voucherId);
			else next.add(entry.voucherId);
			return next;
		});
	}

	rupees(paise: number): string {
		return rupees(paise);
	}

	day(date: string): string {
		return shortDate(date);
	}

	async link(): Promise<void> {
		const start = this.start$();
		if (!start || !this.ready()) return;
		this.busy.set(true);
		this.problem.set(null);
		try {
			await firstValueFrom(this.gateway.link(start.bankAccountId, start.line.id, [...this.picked()]));
			this.modal.close(true);
		} catch (error) {
			this.problem.set(statementProblem(apiProblem(error, 'failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
