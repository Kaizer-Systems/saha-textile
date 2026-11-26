import { randomUUID } from 'node:crypto';

import { Body, Controller, Inject, Injectable, Module, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExportRequest, type ExportColumn } from '@saha-textile/contracts';
import {
	csvText,
	type AdminUserRepository,
	type AuditLogRepository,
	type DocumentRendererPort,
} from '@saha-textile/core-domain';
import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DocumentFormatsService } from '../documents/document-formats.service';
import { DocumentsModule } from '../documents/documents.module';
import { ADMIN_USER_REPOSITORY, AUDIT_LOG_REPOSITORY, DOCUMENT_RENDERER } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { escapeHtml as e } from '../purchasing/purchase-order-document';

type Cell = string | number | null;
/** A byte-order mark: Excel reads a UTF-8 CSV's Bengali names only with it. */
const BOM = String.fromCharCode(0xfeff);

const money = (value: number) =>
	`₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
	/^\d{4}-\d{2}-\d{2}/.test(iso)
		? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC',
			})
		: iso;

/** A cell as it prints (PDF): money with ₹ and Indian grouping, dates as "24 Nov 2026", nothing as blank. */
export function shownCell(value: Cell, column: ExportColumn): string {
	if (value === null || value === '') return '';
	if (column.kind === 'money' && typeof value === 'number') return money(value);
	if (column.kind === 'date' && typeof value === 'string') return day(value);
	if (column.kind === 'number' && typeof value === 'number') return value.toLocaleString('en-IN');
	return String(value);
}

/** CSV keeps amounts as plain numbers and dates as written (ISO), UTF-8 with a byte-order mark so Excel reads Bengali. */
export function exportCsv(request: ExportRequest): string {
	const row = (r: Record<string, Cell>) => request.columns.map((c) => r[c.key] ?? '');
	const lines = request.rows.map(row);
	if (request.totals) lines.push(row(request.totals));
	return `${BOM}${csvText(
		request.columns.map((c) => c.label),
		lines,
	)}`;
}

/** Excel: the title and filters above, the header frozen, numbers as numbers in ₹ format, dates as dates, totals bold. */
export async function exportXlsx(request: ExportRequest, company: string): Promise<Uint8Array> {
	const book = new ExcelJS.Workbook();
	book.creator = company;
	const sheet = book.addWorksheet(request.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
	sheet.addRow([company]).font = { bold: true };
	sheet.addRow([request.title]).font = { bold: true, size: 13 };
	for (const f of request.filters) sheet.addRow([`${f.label}: ${f.value}`]);
	const headerAt = sheet.rowCount + 2;
	sheet.addRow([]);
	const header = sheet.addRow(request.columns.map((c) => c.label));
	header.font = { bold: true };
	const value = (cell: Cell, column: ExportColumn) =>
		column.kind === 'date' && typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cell)
			? new Date(`${cell}T00:00:00Z`)
			: cell;
	for (const r of request.rows) sheet.addRow(request.columns.map((c) => value(r[c.key] ?? null, c)));
	if (request.totals) {
		const totals = request.totals;
		sheet.addRow(request.columns.map((c) => value(totals[c.key] ?? null, c))).font = { bold: true };
	}
	request.columns.forEach((column, i) => {
		const col = sheet.getColumn(i + 1);
		col.width = Math.min(40, Math.max(10, column.label.length + 4));
		if (column.kind === 'money') col.numFmt = '"₹"#,##,##0.00';
		if (column.kind === 'date') col.numFmt = 'dd mmm yyyy';
	});
	sheet.views = [{ state: 'frozen', ySplit: headerAt }];
	sheet.autoFilter = {
		from: { row: headerAt, column: 1 },
		to: { row: headerAt, column: request.columns.length },
	};
	return new Uint8Array(await book.xlsx.writeBuffer());
}

/** When it was printed, as people in the shop read the time: "25 Nov 2026, 18:54 IST". */
export function printedAt(at: Date): string {
	const stamp = at.toLocaleString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	});
	return `${stamp} IST`;
}

/**
 * PDF: A4, landscape past six columns; the company, the report and its filters on top, who printed it and when (in
 * India's time) below the table, page x of y at the foot.
 */
export function exportHtml(request: ExportRequest, company: string, printedBy: string, at: Date): string {
	const numeric = (c: ExportColumn) => c.kind === 'money' || c.kind === 'number';
	const cells = (r: Record<string, Cell>) =>
		request.columns
			.map((c) => `<td class="${numeric(c) ? 'n' : ''}">${e(shownCell(r[c.key] ?? null, c))}</td>`)
			.join('');
	const filters = request.filters.map((f) => `<span>${e(f.label)}: <b>${e(f.value)}</b></span>`).join(' · ');
	return `<!doctype html><html><head><meta charset="utf-8"><title>${e(request.title)}</title><style>
body{font:9pt system-ui,sans-serif;color:#1b1f22;margin:0}h1{font-size:13pt;margin:0 0 2px}.co{font-weight:700}
.f{color:#5b6b72;margin:0 0 8px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #d6e0de;padding:3px 5px;text-align:left;vertical-align:top}
th{font-size:8pt;color:#3d4a4f;background:#eef3f2}.n{text-align:right;white-space:nowrap}tr.t td{font-weight:700;border-top:2px solid #1b1f22}
.by{color:#5b6b72;font-size:8pt;margin-top:6px}thead{display:table-header-group}</style></head><body>
<div class="co">${e(company)}</div><h1>${e(request.title)}</h1><p class="f">${filters}</p>
<table><thead><tr>${request.columns.map((c) => `<th class="${numeric(c) ? 'n' : ''}">${e(c.label)}</th>`).join('')}</tr></thead>
<tbody>${request.rows.map((r) => `<tr>${cells(r)}</tr>`).join('')}${request.totals ? `<tr class="t">${cells(request.totals)}</tr>` : ''}</tbody></table>
<p class="by">Printed by ${e(printedBy)} at ${e(printedAt(at))}</p></body></html>`;
}

const TYPES = {
	csv: 'text/csv; charset=utf-8',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pdf: 'application/pdf',
} as const;

@Injectable()
export class ExportsService {
	constructor(
		@Inject(DocumentFormatsService) private readonly formats: Pick<DocumentFormatsService, 'seller'>,
		@Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentRendererPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'append'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
	) {}

	/** The name the PDF prints: display name, else e-mail, else username, as the edit log names people. */
	private async printedBy(principal: AuthenticatedPrincipal | undefined): Promise<string> {
		if (!principal) return 'someone';
		const user = await this.admins.findById(principal.userId);
		return user?.displayName || user?.email || user?.username || principal.userId;
	}

	/** EX1: the screen's rows as a file; an accounts export goes to the edit log. */
	async file(
		request: ExportRequest,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<{ fileName: string; contentType: string; data: Uint8Array }> {
		const company = (await this.formats.seller({ name: 'Saha Textile', lines: [] })).name;
		let data: Uint8Array;
		if (request.format === 'csv') data = new TextEncoder().encode(exportCsv(request));
		else if (request.format === 'xlsx') data = await exportXlsx(request, company);
		else
			data = await this.renderer.renderPdf({
				html: exportHtml(request, company, await this.printedBy(principal), now),
				assets: [],
				title: request.title,
				author: company,
				page: {
					size: 'A4',
					landscape: request.columns.length > 6,
					marginMm: { top: 12, right: 10, bottom: 14, left: 10 },
				},
				footerHtml: `<div style="font:8px sans-serif;width:100%;text-align:right;padding-right:10mm">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
			});
		if (request.area === 'accounts')
			await this.audit.append({
				id: `aud_${randomUUID()}`,
				actorUserId: principal?.userId ?? null,
				targetUserId: null,
				audience: 'admin',
				action: 'accounts.export',
				entityType: 'export',
				entityId: request.fileName,
				severity: 'info',
				retentionTier: 'financial_security',
				diffs: [],
				metadata: {
					title: request.title,
					format: request.format,
					rows: request.rows.length,
					filters: request.filters.map((f) => `${f.label}: ${f.value}`).join(' · '),
				},
				requestId: null,
				ipHash: null,
				createdAt: now.toISOString(),
			} as never);
		return { fileName: `${request.fileName}.${request.format}`, contentType: TYPES[request.format], data };
	}
}

@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/exports')
export class ExportsController {
	constructor(private readonly exports: ExportsService) {}

	/** Any signed-in admin: the rows come from a screen they already see. */
	@Post()
	@ApiOperation({ operationId: 'exportFile', summary: 'A list or report as CSV, Excel or PDF (brief 25 EX1)' })
	async file(
		@Body(new ZodValidationPipe(ExportRequest)) body: ExportRequest,
		@Res() reply: FastifyReply,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		const file = await this.exports.file(body, principal);
		void reply
			.header('Content-Type', file.contentType)
			.header('Content-Disposition', `attachment; filename="${file.fileName}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(file.data));
	}
}

/** Exports (brief 25 EX). */
@Module({
	imports: [DocumentsModule],
	controllers: [ExportsController],
	providers: [ExportsService],
})
export class ExportsModule {}
