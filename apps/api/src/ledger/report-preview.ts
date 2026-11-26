import { BadRequestException, Controller, Get, Header, Inject, Injectable, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportPreviewQuery, type ReportPreview } from '@saha-textile/contracts';
import { istDay, latestVersion, reportRows, type ReportColumn } from '@saha-textile/core-domain';

import { AccountsTemplatesService } from '../accounts-templates/accounts-templates.service';
import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

/** The day before another (both YYYY-MM-DD). */
const dayBefore = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The first day of the financial year (1 April) a day falls in. */
const yearStart = (day: string): string => {
	const year = Number(day.slice(0, 4));
	return `${Number(day.slice(5, 7)) >= 4 ? year : year - 1}-04-01`;
};

/**
 * Report templates' "Preview with this company" (accounts templates plan AT6): the draft, or else the newest version,
 * worked out on this company's books as they stand on a day, with the year before beside it when the report shows it.
 * A person sees only the locations they may see.
 */
@Injectable()
export class ReportPreviewService {
	constructor(
		@Inject(LedgerService) private readonly ledger: LedgerService,
		@Inject(AccountsTemplatesService) private readonly templates: AccountsTemplatesService,
	) {}

	async preview(
		code: string,
		query: ReportPreviewQuery,
		principal: AuthenticatedPrincipal | undefined,
		today = istDay(new Date()),
	): Promise<ReportPreview> {
		const template = await this.templates.get(code);
		const content = template.draft?.content ?? (template.versions.length ? latestVersion(template).content : null);
		if (content?.kind !== 'report') throw new BadRequestException(accountsRefusal('template_not_a_report'));
		const asAt = query.asAt ?? today;
		const start = yearStart(asAt);
		const lastEnd = dayBefore(start);
		const [chart, closing, opening] = await Promise.all([
			this.ledger.chart(),
			this.ledger.balances(asAt, principal),
			this.ledger.balances(lastEnd, principal),
		]);
		const last: ReportColumn | null =
			content.columns === 'thisAndLast'
				? {
						closing: opening,
						opening: await this.ledger.balances(
							dayBefore(`${Number(start.slice(0, 4)) - 1}-04-01`),
							principal,
						),
					}
				: null;
		const { rows, problems } = reportRows(content, chart, { closing, opening }, last);
		return { asAt, lastAsAt: last ? lastEnd : null, rows, problems };
	}
}

@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/templates')
export class ReportPreviewController {
	constructor(private readonly reports: ReportPreviewService) {}

	@Get(':code/preview')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'accountsReportPreview', summary: 'A report template on this company’s books (AT6)' })
	preview(
		@Param('code') code: string,
		@Query(new ZodValidationPipe(ReportPreviewQuery)) query: ReportPreviewQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	): Promise<ReportPreview> {
		return this.reports.preview(code, query, principal);
	}
}
