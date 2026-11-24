import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { SettlementsGateway } from '@core/accounts/settlements.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { DATE_FORMATS, guessDateFormat } from '@features/accounts/banks/statement-columns';
import { rupees } from '@features/accounts/ledger-helpers';
import { parseCsv } from '@features/purchasing/shared/sheet-rows';

import { PAYOUT_FIELDS, guessPayoutColumns, payoutRows, type PayoutColumns, type PayoutField } from './payout-columns';

import type {
	SettlementImportWrite,
	SettlementKind,
	SettlementPreview,
	StatementDateFormat,
} from '@saha-textile/contracts';

/** The provider a kind starts with; any other can be typed. */
const PROVIDERS: Record<SettlementKind, string> = { gateway: 'CCAvenue', cod: 'Shiprocket' };

/**
 * Import payout file (accounts brief Q10): the gateway's payout file or the courier's COD remittance file as CSV,
 * its columns matched (guessed from its headings), then each payout checked (rows matched to orders, imported
 * already or not) before it is saved and posted.
 */
@Component({
	selector: 'app-settlement-import-popup',
	templateUrl: './settlement-import-popup.html',
	imports: [TranslocoModule, FormsModule],
})
export class SettlementImportPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(SettlementsGateway);
	private readonly banks = inject(BanksGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);

	readonly fields = PAYOUT_FIELDS;
	readonly dateFormats = DATE_FORMATS;
	readonly accounts = injectQuery(() => ({
		queryKey: BANK_KEYS.list,
		queryFn: () => firstValueFrom(this.banks.list()),
	}));

	readonly kind = signal<SettlementKind>('gateway');
	readonly provider = signal(PROVIDERS.gateway);
	readonly bankAccountId = signal('');
	readonly fileName = signal('');
	readonly table = signal<string[][]>([]);
	readonly headingAt = signal(0);
	readonly columns = signal<PayoutColumns>(guessPayoutColumns([]).columns);
	readonly dateFormat = signal<StatementDateFormat>('DD/MM/YYYY');
	readonly step = signal<'map' | 'check'>('map');
	readonly preview = signal<SettlementPreview | null>(null);
	readonly busy = signal(false);
	readonly problem = signal<string | null>(null);

	readonly heading = computed(() => this.table()[this.headingAt()] ?? []);
	readonly read = computed(() => payoutRows(this.table(), this.headingAt(), this.columns(), this.dateFormat()));
	readonly ready = computed(
		() => !!this.bankAccountId() && this.provider().trim().length >= 2 && this.read().rows.length > 0,
	);
	readonly fresh = computed(() => (this.preview()?.payouts ?? []).filter((p) => !p.already).length);

	start(kind: SettlementKind): void {
		this.setKind(kind);
	}

	setKind(kind: SettlementKind): void {
		this.kind.set(kind);
		this.provider.set(PROVIDERS[kind]);
	}

	/** Reads the CSV in the browser and guesses its columns and date format from its headings. */
	async readFile(file: File | null | undefined): Promise<void> {
		if (!file) return;
		this.fileName.set(file.name);
		this.problem.set(null);
		this.table.set([]);
		if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
			this.problem.set('import_csv_only');
			return;
		}
		const rows = parseCsv(await file.text());
		if (!rows.length) {
			this.problem.set('bank_import_empty');
			return;
		}
		const guess = guessPayoutColumns(rows);
		const date = guess.columns.date;
		this.table.set(rows);
		this.headingAt.set(guess.headingAt);
		this.columns.set(guess.columns);
		this.dateFormat.set(guessDateFormat(date === null ? '' : (rows[guess.headingAt + 1]?.[date] ?? '')));
	}

	setColumn(field: PayoutField, value: string): void {
		this.columns.update((columns) => ({ ...columns, [field]: value === '' ? null : Number(value) }));
	}

	private write(): SettlementImportWrite {
		return {
			kind: this.kind(),
			provider: this.provider().trim(),
			bankAccountId: this.bankAccountId(),
			fileName: this.fileName(),
			rows: this.read().rows,
		};
	}

	async check(): Promise<void> {
		if (!this.ready()) return;
		await this.run(async () => {
			this.preview.set(await firstValueFrom(this.gateway.preview(this.write())));
			this.step.set('check');
		});
	}

	async save(): Promise<void> {
		await this.run(async () => {
			const done = await firstValueFrom(this.gateway.import(this.write()));
			this.notifier.showSuccess(
				this.transloco.translate('stl_saved', { saved: done.saved.length, skipped: done.skipped.length }),
			);
			this.modal.close(true);
		});
	}

	back(): void {
		this.step.set('map');
	}

	rupees(paise: number): string {
		return rupees(paise);
	}

	day(date: string): string {
		return shortDate(date);
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		this.problem.set(null);
		try {
			await work();
		} catch (error) {
			const [code] = apiProblem(error, 'failed').split(':');
			this.problem.set(`stl_problem_${code}`);
		} finally {
			this.busy.set(false);
		}
	}
}
