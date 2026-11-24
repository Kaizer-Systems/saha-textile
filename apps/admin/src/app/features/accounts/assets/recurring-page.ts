import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ASSET_KEYS, AssetsGateway } from '@core/accounts/assets.gateway';
import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees, toPaise, type JournalRow } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { RecurringEntry } from '@saha-textile/contracts';

/** What an entry comes to: its debit lines, or nothing when the amounts are filled in when checked. */
export function entryAmount(entry: Pick<RecurringEntry, 'lines'>): number {
	return entry.lines.reduce((sum, l) => sum + l.debitPaise, 0);
}

/** Whether an entry's next day falls within a week of `today`. */
export function dueThisWeek(entry: Pick<RecurringEntry, 'nextOn' | 'active'>, today: string): boolean {
	const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
	return entry.active && entry.nextOn <= week;
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const blank = (): JournalRow => ({ ledgerId: '', locationId: '', debit: '', credit: '', narration: '' });

/**
 * Rent and recurring entries (accounts brief R5): each makes a voucher draft on its day for someone to check and post;
 * lines left at nothing are filled in then ("from last bill").
 */
@Component({
	selector: 'app-recurring-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './recurring-page.html',
})
export class RecurringPage {
	private readonly gateway = inject(AssetsGateway);
	private readonly ledger = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = rupees;
	readonly amount = entryAmount;
	readonly today = istToday();
	readonly chip = signal<'all' | 'week'>('all');
	readonly entries = injectQuery(() => ({
		queryKey: ASSET_KEYS.recurring,
		queryFn: () => firstValueFrom(this.gateway.recurring()),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledger.chart()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly ledgers = computed(() => (this.chart.data()?.ledgers ?? []).filter((l) => l.active !== false));
	readonly rows = computed(() =>
		(this.entries.data() ?? []).filter((e) => this.chip() === 'all' || dueThisWeek(e, this.today)),
	);
	readonly weekCount = computed(() => (this.entries.data() ?? []).filter((e) => dueThisWeek(e, this.today)).length);

	// The add or change pop-up.
	readonly editing = signal<RecurringEntry | null>(null);
	readonly what = signal('');
	readonly party = signal('');
	readonly kind = signal<'journal' | 'payment'>('journal');
	readonly every = signal<'monthDay' | 'monthEnd'>('monthDay');
	readonly day = signal(1);
	readonly reverseNextDay = signal(false);
	readonly startOn = signal(istToday());
	readonly endOn = signal('');
	readonly active = signal(true);
	readonly lines = signal<JournalRow[]>([blank(), blank()]);
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	dateText(date: string): string {
		return shortDate(date);
	}

	open(template: TemplateRef<unknown>, entry: RecurringEntry | null): void {
		this.editing.set(entry);
		this.what.set(entry?.what ?? '');
		this.party.set(entry?.party ?? '');
		this.kind.set(entry?.kind ?? 'journal');
		this.every.set(entry?.every ?? 'monthDay');
		this.day.set(entry?.day ?? 1);
		this.reverseNextDay.set(entry?.reverseNextDay ?? false);
		this.startOn.set(entry?.startOn ?? istToday());
		this.endOn.set(entry?.endOn ?? '');
		this.active.set(entry?.active ?? true);
		this.lines.set(
			entry
				? entry.lines.map((l) => ({
						ledgerId: l.ledgerId,
						locationId: l.locationId,
						debit: l.debitPaise ? String(l.debitPaise / 100) : '',
						credit: l.creditPaise ? String(l.creditPaise / 100) : '',
						narration: l.narration,
					}))
				: [blank(), blank()],
		);
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	setLine(index: number, patch: Partial<JournalRow>): void {
		this.lines.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
	}

	addLine(): void {
		this.lines.update((rows) => [...rows, { ...blank(), locationId: rows.at(-1)?.locationId ?? '' }]);
	}

	removeLine(index: number): void {
		this.lines.update((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
	}

	/** The lines that name a ledger and a location; amounts may stay at nothing until checked. */
	readonly ready = computed(
		() =>
			this.what().trim().length >= 2 &&
			this.lines().some((l) => l.ledgerId && l.locationId) &&
			this.lines().every((l) => !l.ledgerId || l.locationId),
	);

	async save(): Promise<void> {
		const write = {
			what: this.what().trim(),
			party: this.party().trim(),
			kind: this.kind(),
			every: this.every(),
			day: this.day(),
			reverseNextDay: this.kind() === 'journal' && this.reverseNextDay(),
			startOn: this.startOn(),
			endOn: this.endOn() || null,
			active: this.active(),
			lines: this.lines()
				.filter((l) => l.ledgerId)
				.map((l) => ({
					ledgerId: l.ledgerId,
					locationId: l.locationId,
					debitPaise: toPaise(l.debit),
					creditPaise: toPaise(l.credit),
					narration: l.narration,
				})),
		};
		const editing = this.editing();
		await this.run(
			() =>
				editing
					? firstValueFrom(this.gateway.updateRecurring(editing.id, { ...write, version: editing.version }))
					: firstValueFrom(this.gateway.createRecurring(write)),
			'recurring_saved',
		);
	}

	async remove(entry: RecurringEntry): Promise<void> {
		await this.run(() => firstValueFrom(this.gateway.removeRecurring(entry.id)), 'recurring_removed');
	}

	private async run(work: () => Promise<unknown>, done: string): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: ASSET_KEYS.recurring });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`recurring_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
