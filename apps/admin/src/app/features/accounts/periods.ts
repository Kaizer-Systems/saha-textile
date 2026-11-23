import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BookPart, PeriodLock, PeriodState, VoucherAttachment } from '@saha-textile/contracts';

/** T1's columns: "Cash and bank" is one column over the two parts. */
export const PERIOD_COLUMNS: { key: string; parts: BookPart[] }[] = [
	{ key: 'sales', parts: ['sales'] },
	{ key: 'purchases', parts: ['purchases'] },
	{ key: 'stock', parts: ['stock'] },
	{ key: 'cash_bank', parts: ['cash', 'bank'] },
	{ key: 'payroll', parts: ['payroll'] },
	{ key: 'journal', parts: ['journal'] },
];

/** A column's state in a month: the strictest of its parts (locked > closed for staff > open). */
export function columnState(locks: readonly PeriodLock[], month: string, parts: readonly BookPart[]): PeriodState {
	const rank: Record<PeriodState, number> = { open: 0, closed_for_staff: 1, locked: 2 };
	return parts
		.map((part) => locks.find((l) => l.month === month && l.part === part)?.state ?? 'open')
		.reduce<PeriodState>((worst, s) => (rank[s] > rank[worst] ? s : worst), 'open');
}

/**
 * Accounts › Periods and locks (accounts brief T1, T2, as drawn): each part of the books per month, open, closed
 * for staff or locked; Lock a month closes or locks everything or chosen parts with a reason. Reopening is for
 * the super admin (the API refuses others) and is logged.
 */
@Component({
	selector: 'app-periods',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './periods.html',
})
export class PeriodsPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly columns = PERIOD_COLUMNS;
	readonly allParts: BookPart[] = ['sales', 'purchases', 'stock', 'cash', 'bank', 'payroll', 'journal'];
	readonly canLock = computed(() => this.auth.permissions().includes('accounts.lock'));
	readonly grid = injectQuery(() => ({
		queryKey: LEDGER_KEYS.periods,
		queryFn: () => firstValueFrom(this.gateway.periods()),
	}));
	/** This financial year by default; the year before one click away. */
	readonly year = signal<'this' | 'last'>('this');
	readonly months = computed(() => {
		const months = this.grid.data()?.months ?? [];
		return this.year() === 'this' ? months.slice(12) : months.slice(0, 12);
	});
	readonly yearLabel = computed(() => {
		const first = this.months()[0] ?? '';
		const start = Number(first.slice(0, 4));
		return start ? `${start}-${String((start + 1) % 100).padStart(2, '0')}` : '';
	});
	readonly state = (month: string, parts: readonly BookPart[]) =>
		columnState(this.grid.data()?.locks ?? [], month, parts);

	readonly lockMonth = signal('');
	readonly modalOpen = signal(false);
	/** T2: what still needs doing in the chosen month (a lock may go ahead anyway). */
	readonly checks = injectQuery(() => ({
		queryKey: LEDGER_KEYS.checks(this.lockMonth()),
		queryFn: () => firstValueFrom(this.gateway.periodChecks(this.lockMonth())),
		enabled: this.modalOpen() && !!this.lockMonth() && this.canLock(),
	}));
	readonly everything = signal(true);
	readonly chosen = signal<ReadonlySet<BookPart>>(new Set());
	readonly lockState = signal<PeriodState>('locked');
	readonly reason = signal('');
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	private readonly company = inject(CompanyGateway);
	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));
	readonly activeRegistrations = computed(() => (this.registrations.data() ?? []).filter((r) => r.active !== false));
	/** T1's GSTR-3B column: Filed, Not filed, or "1 of 2" with several GSTINs (G8 marks it). */
	gstr3b(month: string): { filed: number; of: number } {
		const of = this.activeRegistrations().length;
		const filed = (this.grid.data()?.filings ?? []).filter(
			(f) => f.returnType === 'GSTR-3B' && f.month === month,
		).length;
		return { filed, of };
	}

	readonly fileMonth = signal('');
	readonly fileRegistration = signal('');
	readonly arn = signal('');
	readonly filedOn = signal(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
	readonly acknowledgement = signal<VoucherAttachment | null>(null);
	readonly filing = signal(false);
	private fileModal: NgbModalRef | null = null;
	readonly unfiledRegistrations = computed(() =>
		this.activeRegistrations().filter(
			(r) =>
				!(this.grid.data()?.filings ?? []).some(
					(f) => f.returnType === 'GSTR-3B' && f.month === this.fileMonth() && f.gstRegistrationId === r.id,
				),
		),
	);
	readonly fileGstin = computed(
		() => this.activeRegistrations().find((r) => r.id === this.fileRegistration())?.gstin ?? '',
	);

	openFile(template: TemplateRef<unknown>, month: string): void {
		if (!this.canLock()) return;
		this.fileMonth.set(month);
		this.fileRegistration.set(this.unfiledRegistrations()[0]?.id ?? '');
		this.arn.set('');
		this.acknowledgement.set(null);
		this.fileModal = this.modals.open(template, { centered: true });
	}

	async attachAck(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'accounts_ack_file',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.acknowledgement.set({ assetId: picked[0].assetId, name: picked[0].name });
	}

	async markFiled(): Promise<void> {
		this.filing.set(true);
		try {
			await firstValueFrom(
				this.gateway.markFiled({
					gstRegistrationId: this.fileRegistration(),
					returnType: 'GSTR-3B',
					month: this.fileMonth(),
					arn: this.arn(),
					filedOn: this.filedOn(),
					acknowledgement: this.acknowledgement(),
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: LEDGER_KEYS.periods });
			this.notifier.showSuccess(this.transloco.translate('accounts_gst_filed_saved'));
			this.fileModal?.close();
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code === 'gst_already_filed' ? 'accounts_gst_already_filed' : 'accounts_gst_file_failed',
				),
			);
		} finally {
			this.filing.set(false);
		}
	}

	open(template: TemplateRef<unknown>, month?: string): void {
		const currentMonth = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
		this.lockMonth.set(month ?? this.months().find((m) => m === currentMonth) ?? this.months()[0] ?? '');
		this.everything.set(true);
		this.chosen.set(new Set());
		this.lockState.set('locked');
		this.reason.set('');
		this.modalOpen.set(true);
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
		void this.modal.result.finally(() => this.modalOpen.set(false)).catch(() => undefined);
	}

	toggle(part: BookPart, on: boolean): void {
		const next = new Set(this.chosen());
		if (on) next.add(part);
		else next.delete(part);
		this.chosen.set(next);
	}

	async lock(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.lock({
					months: [this.lockMonth()],
					parts: this.everything() ? this.allParts : [...this.chosen()],
					state: this.lockState(),
					reason: this.reason(),
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: LEDGER_KEYS.periods });
			this.notifier.showSuccess(this.transloco.translate('accounts_period_saved'));
			this.modal?.close();
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code === 'reopen_super_admin_only' ? 'accounts_reopen_super_admin' : 'accounts_period_failed',
				),
			);
		} finally {
			this.busy.set(false);
		}
	}
}
