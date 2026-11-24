import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { bankProblemKey } from './bank-form';
import {
	COLUMN_ROLES,
	DATE_FORMATS,
	type ColumnRole,
	columnsFrom,
	guessLayout,
	linesNet,
	rolesFrom,
	statementEnds,
} from './statement-columns';
import { StatementImportState, type StatementRead } from './statement-import-popup';

import type { BankLayout, StatementDateFormat, StatementPreview } from '@saha-textile/contracts';

type PreviewLine = StatementPreview['lines'][number];
interface Problem {
	key: string;
	params: Record<string, string>;
}

/** A refusal in words; the totals refusal carries what opening plus the lines came to. */
export function statementProblem(code: string): Problem {
	const [name, amount] = code.split(':');
	if (name === 'statement_totals_differ' || name === 'bank_link_amount_differs')
		return { key: `bank_problem_${name}`, params: { amount: rupees(Number(amount) || 0) } };
	return { key: bankProblemKey(code), params: {} };
}

/**
 * A statement's columns matched once and saved (accounts brief BA5), then every line checked and correctable before
 * saving (BA6): lines the account already holds are skipped, and the statement's opening plus its lines must come to
 * its closing. The file was read in the popup (BA4); nothing is saved until "Save the lines".
 */
@Component({
	selector: 'app-statement-import',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './statement-import.html',
})
export class StatementImportPage {
	private readonly gateway = inject(BanksGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly state = inject(StatementImportState);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly roleChoices = COLUMN_ROLES;
	readonly dateFormats = DATE_FORMATS;

	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	/** The file read for this account; none after a reload, when the popup has to be opened again. */
	readonly read = computed<StatementRead | null>(() => {
		const read = this.state.read();
		return read && read.bankAccountId === this.id() ? read : null;
	});
	readonly account = injectQuery(() => ({
		queryKey: BANK_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly layouts = injectQuery(() => ({
		queryKey: BANK_KEYS.layouts,
		queryFn: () => firstValueFrom(this.gateway.layouts()),
	}));

	readonly step = signal<'columns' | 'review'>('columns');
	readonly busy = signal(false);
	readonly problem = signal<Problem | null>(null);

	// BA5: the layout being matched.
	readonly layoutId = signal<string | null>(null);
	readonly layoutName = signal('');
	readonly skipRows = signal(0);
	readonly dateFormat = signal<StatementDateFormat>('DD/MM/YY');
	readonly money = signal<BankLayout['money']>('split');
	readonly roles = signal<ColumnRole[]>([]);
	/** Each column of the file: its heading (the row above the first line) and the first line's value. */
	readonly fileColumns = computed(() => {
		const rows = this.read()?.rows ?? [];
		const heading = rows[this.skipRows() - 1] ?? [];
		const example = rows[this.skipRows()] ?? [];
		return this.roles().map((role, index) => ({
			index,
			heading: heading[index]?.trim() ?? '',
			example: example[index]?.trim() ?? '',
			role,
		}));
	});

	// BA6: the lines read, as corrected.
	readonly lines = signal<PreviewLine[]>([]);
	readonly problems = signal<StatementPreview['problems']>([]);
	readonly openingPaise = signal(0);
	readonly closingPaise = signal(0);
	readonly editing = signal<number | null>(null);
	readonly computedPaise = computed(() => this.openingPaise() + linesNet(this.lines()));
	readonly matches = computed(() => this.computedPaise() === this.closingPaise());
	readonly already = computed(() => this.lines().filter((line) => line.already).length);

	private started = false;

	constructor() {
		// Once the file and the saved layouts are here: a saved layout goes straight to the lines, a new file gets a guess.
		effect(() => {
			const read = this.read();
			const layouts = this.layouts.data();
			if (this.started || !read || !layouts) return;
			this.started = true;
			void this.begin(read, layouts);
		});
	}

	private async begin(read: StatementRead, layouts: readonly BankLayout[]): Promise<void> {
		const saved = layouts.find((layout) => layout.id === read.layoutId) ?? null;
		const base = saved ?? guessLayout(read.rows);
		const width = Math.max(...read.rows.slice(0, 50).map((row) => row.length));
		this.layoutId.set(saved?.id ?? null);
		this.layoutName.set(saved?.name ?? '');
		this.skipRows.set(base.skipRows);
		this.dateFormat.set(base.dateFormat);
		this.money.set(base.money);
		this.roles.set(rolesFrom(base.columns, width));
		if (saved) await this.review();
	}

	/** One role per column: picking a role a column already has frees that column. */
	setRole(index: number, role: ColumnRole): void {
		this.roles.update((roles) =>
			roles.map((current, at) => (at === index ? role : current === role && role !== 'skip' ? 'skip' : current)),
		);
	}

	/** BA5 Next: saves the layout for next time, then reads the lines with it. */
	async next(): Promise<void> {
		const read = this.read();
		if (!read || this.busy()) return;
		this.busy.set(true);
		this.problem.set(null);
		const extension = /\.([a-z0-9]+)$/i.exec(read.fileName)?.[1]?.toUpperCase() ?? 'CSV';
		try {
			const layout = await firstValueFrom(
				this.gateway.saveLayout({
					id: this.layoutId(),
					name: this.layoutName() || `${this.account.data()?.bankName ?? ''} ${extension}`.trim(),
					skipRows: this.skipRows(),
					dateFormat: this.dateFormat(),
					money: this.money(),
					columns: columnsFrom(this.roles()),
				}),
			);
			this.layoutId.set(layout.id);
			this.layoutName.set(layout.name);
			await this.queries.invalidateQueries({ queryKey: BANK_KEYS.layouts });
			await this.review();
		} catch (error) {
			this.problem.set(statementProblem(apiProblem(error, 'failed')));
		} finally {
			this.busy.set(false);
		}
	}

	/** The lines as the saved layout reads them, each marked when the account already holds it. */
	async review(): Promise<void> {
		const read = this.read();
		const layoutId = this.layoutId();
		if (!read || !layoutId) return;
		try {
			const preview = await firstValueFrom(this.gateway.preview(this.id(), { layoutId, rows: read.rows }));
			const ends = statementEnds(preview.lines);
			this.lines.set(preview.lines);
			this.problems.set(preview.problems);
			this.openingPaise.set(ends.openingPaise);
			this.closingPaise.set(ends.closingPaise);
			this.editing.set(null);
			this.step.set('review');
		} catch (error) {
			this.problem.set(statementProblem(apiProblem(error, 'failed')));
		}
	}

	back(): void {
		this.problem.set(null);
		if (this.step() === 'review') this.step.set('columns');
		else void this.router.navigate(['/accounts/banks', this.id()]);
	}

	/** A corrected cell: text as typed, money typed in rupees and kept in paise. */
	setCell(index: number, field: 'date' | 'description' | 'reference' | 'out' | 'in', value: string | number): void {
		this.lines.update((lines) =>
			lines.map((line, at) => {
				if (at !== index) return line;
				if (field === 'out') return { ...line, outPaise: paiseOf(value) };
				if (field === 'in') return { ...line, inPaise: paiseOf(value) };
				return { ...line, [field]: String(value) };
			}),
		);
	}

	setEnd(which: 'opening' | 'closing', value: string | number): void {
		(which === 'opening' ? this.openingPaise : this.closingPaise).set(Math.round((Number(value) || 0) * 100));
	}

	rupees(paise: number): string {
		return rupees(paise);
	}

	/** `25 Nov 2026`. */
	day(date: string): string {
		return shortDate(date);
	}

	/** Every line goes, held ones too: the totals check covers the whole statement and the server skips what it holds. */
	async save(): Promise<void> {
		const read = this.read();
		if (!read || !this.lines().length || this.busy()) return;
		this.busy.set(true);
		this.problem.set(null);
		try {
			const done = await firstValueFrom(
				this.gateway.saveLines(this.id(), {
					fileName: read.fileName,
					openingPaise: this.openingPaise(),
					closingPaise: this.closingPaise(),
					lines: this.lines().map((line) => ({
						date: line.date,
						description: line.description,
						reference: line.reference,
						outPaise: line.outPaise,
						inPaise: line.inPaise,
						balancePaise: line.balancePaise,
					})),
				}),
			);
			this.notifier.showSuccess(
				this.transloco.translate('bank_lines_saved', { saved: done.saved, skipped: done.skipped }),
			);
			this.state.read.set(null);
			await this.queries.invalidateQueries({ queryKey: BANK_KEYS.all });
			void this.router.navigate(['/accounts/banks', this.id()]);
		} catch (error) {
			this.problem.set(statementProblem(apiProblem(error, 'failed')));
		} finally {
			this.busy.set(false);
		}
	}
}

/** Rupees typed in a money box, in paise; never below nothing. */
function paiseOf(value: string | number): number {
	return Math.max(0, Math.round((Number(value) || 0) * 100));
}
