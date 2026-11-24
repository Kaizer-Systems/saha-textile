import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';

import { accountsRange } from '../accounts-period';

import type { AuditChip } from '@saha-textile/contracts';

export const AUDIT_CHIPS: readonly AuditChip[] = [
	'all',
	'edits',
	'backdated',
	'cancelled',
	'unlocks',
	'takeovers',
	'superAdmin',
];

/** When, as the table shows it: the day and time in India. */
export function whenText(at: string): string {
	return new Date(at).toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'Asia/Kolkata',
	});
}

/**
 * The audit report (accounts brief U8): every change across the books in a period with who made it, by kind, searched;
 * Export for the CA saves every matching row as a spreadsheet file.
 */
@Component({
	selector: 'app-audit-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker],
	templateUrl: './audit-page.html',
})
export class AuditPage {
	private readonly gateway = inject(ReportsGateway);
	private readonly transloco = inject(TranslocoService);

	readonly chips = AUDIT_CHIPS;
	readonly presets = ACCOUNTS_PRESETS;
	readonly when = whenText;
	readonly chip = signal<AuditChip>('all');
	readonly q = signal('');
	readonly page = signal(1);
	readonly range = signal(accountsRange({ period: 'this_month' }));
	readonly report = injectQuery(() => {
		const query = {
			...this.range(),
			chip: this.chip(),
			page: this.page(),
			...(this.q().trim() ? { q: this.q().trim() } : {}),
		};
		return {
			queryKey: REPORT_KEYS.audit(query),
			queryFn: () => firstValueFrom(this.gateway.audit(query)),
		};
	});

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.page.set(1);
	}

	pick(chip: AuditChip): void {
		this.chip.set(chip);
		this.page.set(1);
	}

	pages(total: number): number[] {
		return Array.from({ length: Math.max(1, Math.ceil(total / 50)) }, (_, i) => i + 1);
	}

	async export(): Promise<void> {
		const all = await firstValueFrom(
			this.gateway.audit({
				...this.range(),
				chip: this.chip(),
				page: 1,
				pageSize: 500,
				...(this.q().trim() ? { q: this.q().trim() } : {}),
			}),
		);
		const t = (key: string) => this.transloco.translate(key);
		downloadCsv(
			`audit_${this.range().from}_${this.range().to}.csv`,
			[t('audit_when'), t('audit_who'), t('audit_document'), t('audit_what'), t('audit_detail')],
			all.rows.map((r) => [r.at, r.who, `${r.entityType ?? ''} ${r.entityId ?? ''}`.trim(), r.action, r.detail]),
		);
	}
}
