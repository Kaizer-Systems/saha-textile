import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { booksWords } from '@core/accounts/books-refusal';
import { ConvertGateway } from '@core/accounts/convert.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { drCr } from '@features/accounts/ledger-helpers';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BusinessKind, ConvertPreview, ConvertTarget } from '@saha-textile/contracts';

export const KINDS: readonly BusinessKind[] = [
	'proprietorship',
	'partnership',
	'llp',
	'private_limited_opc',
	'private_limited',
];

/** The last day of the month before today, in India: the usual last day of the old books. */
export function lastMonthEnd(now = new Date()): string {
	const india = new Date(now.getTime() + 5.5 * 3_600_000);
	return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), 0)).toISOString().slice(0, 10);
}

/** A choice in a row's "Goes to": a ledger, a ledger of the new kind's chart by key, or a new one named here. */
const NEW = 'new';

/**
 * Settings › Company › Convert (Postings and Convert brief AC2; AC-D1 the same deployment, AC-D2 the super admin, Preview
 * first, no undo): the new kind, the last day of the old books, and where each owners' account (and the profit so far)
 * goes. Convert locks the old months, adds the new kind's chart and posts one opening voucher the next day.
 */
@Component({
	selector: 'app-convert-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './convert-page.html',
})
export class ConvertPage {
	private readonly gateway = inject(ConvertGateway);
	private readonly company = inject(CompanyGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly router = inject(Router);

	readonly profile = injectQuery(() => ({
		queryKey: COMPANY_KEYS.profile,
		queryFn: () => firstValueFrom(this.company.profile()),
	}));
	readonly kinds = computed(() => KINDS.filter((kind) => kind !== this.profile.data()?.kind));
	readonly kind = signal<BusinessKind | ''>('');
	readonly lastDay = signal(lastMonthEnd());
	readonly preview = signal<ConvertPreview | null>(null);
	/** Per row: `id:<ledgerId>`, `key:<key>` or `new`. */
	readonly choice = signal<Readonly<Record<string, string>>>({});
	readonly names = signal<Readonly<Record<string, string>>>({});
	readonly busy = signal(false);
	readonly drCr = drCr;
	readonly NEW = NEW;

	private readonly t = (key: string, params: Record<string, string> = {}) => this.transloco.translate(key, params);

	/** Rows with nowhere to go yet (a new ledger needs a name). */
	readonly unmapped = computed(() =>
		(this.preview()?.rows ?? []).filter((row) => {
			const choice = this.choice()[row.from];
			return !choice || (choice === NEW && (this.names()[row.from] ?? '').trim().length < 2);
		}),
	);
	readonly canConvert = computed(() => {
		const preview = this.preview();
		return !!preview && !preview.problems.length && !this.unmapped().length && !this.busy();
	});

	/** A refusal in words: Convert's own codes (`convert_row_not_mapped:led_x` without the row), the books', or a failure. */
	words(code: string): string {
		if (!code) return this.t('cv_failed');
		if (code.startsWith('convert_')) return this.t(`cv_problem_${code.split(':')[0]}`);
		return booksWords(code, this.t);
	}

	rowName(row: ConvertPreview['rows'][number]): string {
		return row.from === 'profit' ? this.t('cv_profit_row') : row.name;
	}

	pick(from: string, value: string): void {
		this.choice.update((choice) => ({ ...choice, [from]: value }));
	}

	name(from: string, value: string): void {
		this.names.update((names) => ({ ...names, [from]: value }));
	}

	async load(): Promise<void> {
		const kind = this.kind();
		if (!kind) return;
		this.busy.set(true);
		try {
			this.preview.set(await firstValueFrom(this.gateway.preview(kind, this.lastDay())));
			this.choice.set({});
			this.names.set({});
		} catch (error) {
			this.preview.set(null);
			this.notifier.showError(this.words(apiProblem(error, '')));
		} finally {
			this.busy.set(false);
		}
	}

	private target(from: string): ConvertTarget {
		const choice = String(this.choice()[from]);
		if (choice === NEW) return { newName: String(this.names()[from]).trim() };
		return choice.startsWith('key:') ? { key: choice.slice(4) } : { ledgerId: choice.slice(3) };
	}

	async convert(): Promise<void> {
		const preview = this.preview();
		if (!preview || !this.canConvert()) return;
		const sure = await askConfirm(this.modals, {
			icon: 'ri-exchange-line',
			title: 'cv_confirm_title',
			body: 'cv_confirm_body',
			params: { kind: this.t(`co_kind_${preview.to}`), date: preview.openingDate },
			yes: 'cv_convert',
			danger: true,
		});
		if (!sure) return;
		this.busy.set(true);
		try {
			const done = await firstValueFrom(
				this.gateway.convert({
					kind: preview.to,
					lastDay: preview.lastDay,
					mapping: preview.rows.map((row) => ({ from: row.from, to: this.target(row.from) })),
				}),
			);
			await this.queryClient.invalidateQueries();
			this.notifier.showSuccess(this.t('cv_done', { months: String(done.months) }));
			await this.router.navigate(['/setting/company']);
		} catch (error) {
			this.notifier.showError(this.words(apiProblem(error, '')));
		} finally {
			this.busy.set(false);
		}
	}
}
