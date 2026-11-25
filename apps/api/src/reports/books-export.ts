import { randomUUID } from 'node:crypto';

import { BadRequestException, Controller, Get, Header, Inject, Injectable, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BooksExportQuery, VoucherKind, type BooksExportFile, type JournalVoucher } from '@saha-textile/contracts';
import {
	TALLY_GROUPS,
	csvText,
	tallyXml,
	yearFigures,
	type AuditLogRepository,
	type GeneralLedgerRepository,
} from '@saha-textile/core-domain';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AUDIT_LOG_REPOSITORY, GENERAL_LEDGER_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';
import { API_TAGS } from '../openapi-tags';
import { BooksReportsService } from './books-reports.service';

const MAX_VOUCHERS = 20_000;
const rupees = (paise: number) => (paise / 100).toFixed(2);
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const PLACED = new Set(Object.values(TALLY_GROUPS));

/**
 * Export the books (accounts brief W4): a TallyPrime file (ledgers with their opening balances and every voucher as a
 * journal), the trial balance in our import template's columns, every ledger line, or the edit log. Every export is
 * logged (who, when, what period); no personal numbers ever leave (payroll's are never part of the books).
 */
@Injectable()
export class BooksExportService {
	constructor(
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly books: Pick<GeneralLedgerRepository, 'listVouchers' | 'balancesAt'>,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'chart' | 'balancesAtLocations'>,
		@Inject(BooksReportsService) private readonly reports: Pick<BooksReportsService, 'auditReport'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
	) {}

	private async vouchers(from: string, to: string): Promise<JournalVoucher[]> {
		const out: JournalVoucher[] = [];
		for (let page = 1; ; page += 1) {
			const found = await this.books.listVouchers({
				from,
				to,
				kinds: VoucherKind.options,
				search: '',
				page,
				pageSize: 500,
			});
			if (found.total > MAX_VOUCHERS) throw new BadRequestException(accountsRefusal('export_too_large'));
			out.push(...found.items);
			if (out.length >= found.total || !found.items.length) return out;
		}
	}

	async export(query: BooksExportQuery, principal: AuthenticatedPrincipal | undefined): Promise<BooksExportFile> {
		if (query.from > query.to) throw new BadRequestException(accountsRefusal('report_period_backwards'));
		const only = query.locationId ? [query.locationId] : [];
		const chart = await this.ledger.chart();
		const groups = new Map(chart.groups.map((g) => [g.id, g]));
		const ledgers = new Map(chart.ledgers.map((l) => [l.id, l]));
		/** A ledger's place: the nearest group up its chain that Tally has a primary group for. */
		const placeOf = (groupId: string): string | null => {
			let group = groups.get(groupId);
			while (group) {
				if (group.systemKey && PLACED.has(group.systemKey)) return group.systemKey;
				group = group.parentId ? groups.get(group.parentId) : undefined;
			}
			return null;
		};
		const nameOf = (id: string) => ledgers.get(id)?.name ?? id;
		const groupName = (groupId: string) => groups.get(groupId)?.name ?? '';
		const inScope = (locationId: string) => !only.length || only.includes(locationId);
		let file: BooksExportFile;
		if (query.format === 'trial_balance_csv') {
			const eve = `${Number(query.to.slice(0, 4)) - (query.to.slice(5) < '04-01' ? 1 : 0)}-03-31`;
			const [closing, opening] = await Promise.all([
				this.ledger.balancesAtLocations(query.to, principal, only),
				this.ledger.balancesAtLocations(eve, principal, only),
			]);
			// Income and expense for the year so far; earlier years' profit in the profit and loss account.
			const balances = yearFigures(chart.ledgers, closing, opening);
			file = {
				fileName: `trial-balance-${query.to}.csv`,
				text: csvText(
					['Ledger', 'Group', 'Debit', 'Credit'],
					chart.ledgers
						.filter((l) => balances[l.id])
						.map((l) => {
							const b = balances[l.id] as number;
							return [l.name, groupName(l.groupId), b > 0 ? rupees(b) : '', b < 0 ? rupees(-b) : ''];
						}),
				),
			};
		} else if (query.format === 'ledger_lines_csv') {
			const rows = (await this.vouchers(query.from, query.to)).flatMap((v) =>
				v.lines
					.filter((l) => inScope(l.locationId))
					.map((l) => [
						v.date,
						v.number,
						v.kind,
						nameOf(l.ledgerId),
						l.locationId,
						l.narration || v.narration,
						l.debitPaise ? rupees(l.debitPaise) : '',
						l.creditPaise ? rupees(l.creditPaise) : '',
					]),
			);
			file = {
				fileName: `ledger-lines-${query.from}-to-${query.to}.csv`,
				text: csvText(['Date', 'Voucher', 'Kind', 'Ledger', 'Location', 'Narration', 'Debit', 'Credit'], rows),
			};
		} else if (query.format === 'edit_log_csv') {
			const report = await this.reports.auditReport({
				from: query.from,
				to: query.to,
				chip: 'all',
				page: 1,
				pageSize: 500,
			});
			file = {
				fileName: `edit-log-${query.from}-to-${query.to}.csv`,
				text: csvText(
					['When', 'Who', 'What', 'Record', 'Change'],
					report.rows.map((r) => [
						r.at,
						r.who,
						r.action,
						`${r.entityType ?? ''} ${r.entityId ?? ''}`.trim(),
						r.detail,
					]),
				),
			};
		} else {
			const opening = await this.ledger.balancesAtLocations(dayBefore(query.from), principal, only);
			const vouchers = (await this.vouchers(query.from, query.to)).filter((v) => v.source?.type !== 'yearClose');
			file = {
				fileName: `tally-${query.from}-to-${query.to}.xml`,
				text: tallyXml(
					chart.ledgers.map((l) => ({
						name: l.name,
						groupKey: placeOf(l.groupId),
						openingPaise: opening[l.id] ?? 0,
					})),
					vouchers.flatMap((v) => {
						const lines = v.lines
							.filter((l) => inScope(l.locationId))
							.map((l) => ({ ledger: nameOf(l.ledgerId), debitPaise: l.debitPaise - l.creditPaise }));
						return lines.length ? [{ number: v.number, date: v.date, narration: v.narration, lines }] : [];
					}),
				),
			};
		}
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: principal?.userId ?? null,
			targetUserId: null,
			audience: 'admin',
			action: 'accounts.export',
			entityType: 'books',
			entityId: null,
			severity: 'info',
			retentionTier: 'financial_security',
			diffs: [],
			metadata: { format: query.format, from: query.from, to: query.to, locationId: query.locationId ?? null },
			requestId: null,
			ipHash: null,
			createdAt: new Date().toISOString(),
		} as never);
		return file;
	}
}

/** Accounts › Import › Export the books (W4). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/export')
export class BooksExportController {
	constructor(private readonly exports: BooksExportService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'booksExport', summary: 'Export the books for the CA or another program (W4)' })
	export(
		@Query(new ZodValidationPipe(BooksExportQuery)) query: BooksExportQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.exports.export(query, principal);
	}
}
