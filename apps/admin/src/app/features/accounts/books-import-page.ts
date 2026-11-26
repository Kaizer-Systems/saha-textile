import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BOOKS_IMPORT_KEYS, BooksImportGateway } from '@core/accounts/books-import.gateway';
import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { drCr, rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { BooksImport, ImportPreview, ImportRow, ImportSource, ImportStart } from '@saha-textile/contracts';

export const IMPORT_STEPS = ['source', 'match', 'check', 'done'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

/** The next 1 April on or after a day, where a year's books usually start. */
export function nextYearStart(now = new Date()): string {
	const day = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
	const y = Number(day.slice(0, 4));
	return day.slice(5) <= '04-01' ? `${y}-04-01` : `${y + 1}-04-01`;
}

/** A choice key: an existing ledger (`l:<id>`) or a new ledger in a group (`g:<key>`). */
export function choiceOf(key: string): { ledgerId: string | null; groupKey: string | null } {
	if (key.startsWith('l:')) return { ledgerId: key.slice(2), groupKey: null };
	if (key.startsWith('g:')) return { ledgerId: null, groupKey: key.slice(2) };
	return { ledgerId: null, groupKey: null };
}

/** Rows with a balance still to place once the person's choices are counted. */
export function stillToChoose(rows: readonly ImportRow[], chosen: Readonly<Record<string, string>>): number {
	return rows.filter((r) => r.openingPaise && r.how === 'choose' && !chosen[r.name]).length;
}

/**
 * Bring your books in (accounts brief I1, W1–W3): pick the program and the day the books start, read the file, match
 * its ledgers (choosing where the rest go), check, then bring them in as one opening journal. Nothing is saved until
 * "Bring in"; the import can be undone until a new entry is posted.
 */
@Component({
	selector: 'app-books-import-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, HasPermissionDirective],
	templateUrl: './books-import-page.html',
})
export class BooksImportPage {
	private readonly gateway = inject(BooksImportGateway);
	private readonly ledger = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly steps = IMPORT_STEPS;
	readonly money = rupees;
	readonly balance = drCr;
	readonly step = signal<ImportStep>('source');
	readonly source = signal<ImportSource>('tally_xml');
	readonly start = signal<ImportStart>('year_start');
	readonly startOn = signal(nextYearStart());
	readonly locationId = signal('');
	readonly fileName = signal('');
	readonly text = signal('');
	readonly preview = signal<ImportPreview | null>(null);
	readonly chosen = signal<Record<string, string>>({});
	readonly onlyToCheck = signal(false);
	readonly done = signal<BooksImport | null>(null);
	readonly busy = signal(false);
	readonly imports = injectQuery(() => ({
		queryKey: BOOKS_IMPORT_KEYS.list,
		queryFn: () => firstValueFrom(this.gateway.list()),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledger.chart()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly rows = computed(() => {
		const all = this.preview()?.rows ?? [];
		return this.onlyToCheck() ? all.filter((r) => r.how === 'choose' || r.how === 'new') : all;
	});
	readonly withBalance = computed(() => (this.preview()?.rows ?? []).filter((r) => r.openingPaise !== 0).length);
	readonly toChoose = computed(() => stillToChoose(this.preview()?.rows ?? [], this.chosen()));
	readonly ledgers = computed(() => this.chart.data()?.ledgers.filter((l) => l.active !== false) ?? []);
	readonly groups = computed(() => this.chart.data()?.groups.filter((g) => !!g.systemKey) ?? []);

	day(date: string): string {
		return shortDate(date);
	}

	ourName(row: ImportRow): string {
		if (row.ledgerId) return this.chart.data()?.ledgers.find((l) => l.id === row.ledgerId)?.name ?? '';
		const group = this.chart.data()?.groups.find((g) => g.systemKey === row.groupKey);
		return group ? this.transloco.translate('import_new_in', { group: group.name }) : '';
	}

	choose(name: string, key: string): void {
		this.chosen.update((c) => ({ ...c, [name]: key }));
	}

	async read(event: Event): Promise<void> {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		this.fileName.set(file.name);
		this.text.set(await file.text());
	}

	private input() {
		return {
			source: this.source(),
			start: this.start(),
			startOn: this.startOn(),
			fileName: this.fileName(),
			text: this.text(),
		};
	}

	private problem(error: unknown): void {
		this.notifier.showError(this.transloco.translate(`import_problem_${apiProblem(error, 'failed')}`));
	}

	async check(): Promise<void> {
		this.busy.set(true);
		try {
			this.preview.set(await firstValueFrom(this.gateway.check(this.input())));
			this.chosen.set({});
			this.step.set('match');
		} catch (error) {
			this.problem(error);
		} finally {
			this.busy.set(false);
		}
	}

	async bringIn(): Promise<void> {
		this.busy.set(true);
		try {
			const choices = Object.entries(this.chosen()).map(([name, key]) => ({ name, ...choiceOf(key) }));
			this.done.set(
				await firstValueFrom(this.gateway.bringIn({ ...this.input(), locationId: this.locationId(), choices })),
			);
			this.step.set('done');
			this.notifier.showSuccess(this.transloco.translate('import_brought_in'));
			await this.queries.invalidateQueries({ queryKey: BOOKS_IMPORT_KEYS.list });
		} catch (error) {
			this.problem(error);
		} finally {
			this.busy.set(false);
		}
	}

	async undo(entry: BooksImport): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.undo(entry.id));
			this.notifier.showSuccess(this.transloco.translate('import_undone'));
			await this.queries.invalidateQueries({ queryKey: BOOKS_IMPORT_KEYS.list });
		} catch (error) {
			this.problem(error);
		} finally {
			this.busy.set(false);
		}
	}
}
