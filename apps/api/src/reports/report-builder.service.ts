import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	Optional,
	NotFoundException,
} from '@nestjs/common';
import {
	VoucherKind,
	type ReportCatalogue,
	type ReportDataset,
	type ReportDefinition,
	type ReportDefinitionEdit,
	type ReportDefinitionWrite,
	type ReportRun,
	type ReportTable,
} from '@saha-textile/contracts';
import {
	AUDIT_REPORT_TEMPLATES,
	REPORT_DATASETS,
	resolveRole,
	runReport,
	specProblems,
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type CompanyRepository,
	type CreditNoteRepository,
	type GeneralLedgerRepository,
	type ReportDefinitionRepository,
	type ReportRow,
	type TaxInvoiceRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	COMPANY_REPOSITORY,
	CREDIT_NOTE_REPOSITORY,
	GENERAL_LEDGER_REPOSITORY,
	REPORT_DEFINITION_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LocationsService } from '../locations/locations.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);
/** The preview shows this many rows; a run at most `RUN_LIMIT`. */
export const PREVIEW_LIMIT = 50;
export const RUN_LIMIT = 5_000;
/** How many vouchers a period may read before the report is refused (narrow the period). */
const MAX_VOUCHERS = 20_000;
/** Brief 26 AU2: the audit trail, its source and its starting reports are for those who may see the audit trail. */
const AUDIT_PERMISSION = 'audit.index';
const BUILT_IN_PREFIX = 'rpt_audit_';
const mayAudit = (principal: AuthenticatedPrincipal | undefined) => !!principal?.permissions.includes(AUDIT_PERMISSION);

/** AU2: the starting audit reports as saved reports, for this month (a moving period), never edited or deleted. */
export function auditTemplates(now: Date): ReportDefinition[] {
	const ist = new Date(now.getTime() + 5.5 * 3_600_000);
	const month = ist.toISOString().slice(0, 7);
	const last = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).getUTCDate();
	return AUDIT_REPORT_TEMPLATES.map((t) => ({
		id: `${BUILT_IN_PREFIX}${t.code.slice(3).toLowerCase()}`,
		name: `${t.code} · ${t.name}`,
		folder: t.kind === 'business' ? 'Audit: for this business' : 'Audit: for any business',
		spec: {
			dataset: 'auditLines',
			columns: [...t.columns],
			filters: t.filters.map((f) => ({ ...f, values: [...f.values] })),
			groupBy: [...t.groupBy],
			totals: [...t.totals],
			sort: t.sort,
		},
		periodPreset: 'this_month',
		from: `${month}-01`,
		to: `${month}-${String(last).padStart(2, '0')}`,
		openTo: 'all',
		roleIds: [],
		createdBy: null,
		createdByName: 'Saha Textile',
		createdAt: '2026-11-26T00:00:00.000Z',
		updatedAt: '2026-11-26T00:00:00.000Z',
		version: 0,
	}));
}

/**
 * The custom report builder (accounts brief V1, V2). Rows of the chosen data are read for the period, only at the
 * locations the person may see, and worked into the table by core `runReport`. Saved reports keep the choices; who may
 * open one is its maker, chosen roles, or everyone who may see the figures.
 */
@Injectable()
export class ReportBuilderService {
	constructor(
		@Inject(GENERAL_LEDGER_REPOSITORY)
		private readonly books: Pick<GeneralLedgerRepository, 'listVouchers' | 'chart' | 'getVoucher'>,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'listRegistrations'>,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForGstin'>,
		@Inject(CREDIT_NOTE_REPOSITORY) private readonly creditNotes: Pick<CreditNoteRepository, 'listForGstin'>,
		@Inject(REPORT_DEFINITION_REPOSITORY) private readonly definitions: ReportDefinitionRepository,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'listActiveForUser'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		@Inject(LocationsService) private readonly locations: Pick<LocationsService, 'list'>,
		// Brief 26 AU2: the audit trail as a source (optional, so an older composition still starts).
		@Optional()
		@Inject(AUDIT_LOG_REPOSITORY)
		private readonly audit: Pick<AuditLogRepository, 'list'> | null = null,
	) {}

	/** V1 "Report on" and "Columns": each kind of data and its fields. */
	catalogue(): ReportCatalogue {
		return Object.fromEntries(
			Object.entries(REPORT_DATASETS).map(([key, fields]) => [
				key,
				fields.map((f) => ({ key: f.key, type: f.type, summable: f.summable })),
			]),
		) as ReportCatalogue;
	}

	/** Location ids and names the person may see. */
	private async visible(principal: AuthenticatedPrincipal | undefined): Promise<Map<string, string>> {
		return new Map((await this.locations.list(principal)).map((l) => [l.id, l.name]));
	}

	private async ledgerLines(from: string, to: string, places: Map<string, string>): Promise<ReportRow[]> {
		const chart = await this.books.chart();
		const ledgers = new Map(chart.ledgers.map((l) => [l.id, l]));
		const groups = new Map(chart.groups.map((g) => [g.id, g.name]));
		const rows: ReportRow[] = [];
		let read = 0;
		for (let page = 1; ; page += 1) {
			const found = await this.books.listVouchers({
				from,
				to,
				kinds: VoucherKind.options,
				search: '',
				page,
				pageSize: 500,
			});
			read += found.items.length;
			if (found.total > MAX_VOUCHERS) throw refuse('report_too_large');
			for (const voucher of found.items)
				for (const line of voucher.source?.type === 'yearClose' ? [] : voucher.lines) {
					if (!places.has(line.locationId)) continue;
					const ledger = ledgers.get(line.ledgerId);
					rows.push({
						date: voucher.date,
						month: voucher.date.slice(0, 7),
						voucher: voucher.number,
						voucherKind: voucher.kind,
						source: voucher.source?.type ?? '',
						ledger: ledger?.name ?? line.ledgerId,
						group: ledger ? (groups.get(ledger.groupId) ?? '') : '',
						location: places.get(line.locationId) as string,
						narration: line.narration || voucher.narration,
						debit: line.debitPaise,
						credit: line.creditPaise,
						net: line.debitPaise - line.creditPaise,
					});
				}
			if (read >= found.total || !found.items.length) break;
		}
		return rows;
	}

	/** Issued tax invoices (not cancelled) and issued credit notes of every GSTIN in the period, at visible locations. */
	private async documents(from: string, to: string, places: Map<string, string>) {
		const registrations = await this.company.listRegistrations();
		const lists = await Promise.all(
			registrations.map(async (r) => ({
				invoices: await this.invoices.listForGstin(r.gstin, from, to),
				notes: await this.creditNotes.listForGstin(r.gstin, from, to),
			})),
		);
		return {
			invoices: lists
				.flatMap((l) => l.invoices)
				.filter((i) => i.status !== 'cancelled' && places.has(i.locationId)),
			notes: lists.flatMap((l) => l.notes).filter((n) => n.status === 'issued' && places.has(n.locationId)),
		};
	}

	private async invoiceLines(from: string, to: string, places: Map<string, string>): Promise<ReportRow[]> {
		const { invoices, notes } = await this.documents(from, to, places);
		const docs = [
			...invoices.map((doc) => ({ doc, kind: 'invoice', number: doc.number, sign: 1 })),
			...notes.map((doc) => ({ doc, kind: 'creditNote', number: doc.number ?? '', sign: -1 })),
		];
		return docs.flatMap(({ doc, kind, number, sign }) =>
			doc.lines.map((line) => ({
				date: doc.date,
				month: doc.date.slice(0, 7),
				document: number,
				documentKind: kind,
				gstin: doc.gstin,
				location: places.get(doc.locationId) as string,
				buyer: doc.buyer.name,
				buyerGstin: doc.buyer.gstin ?? '',
				state: doc.buyer.stateCode,
				product: line.title,
				sku: line.sku,
				hsn: line.hsn,
				unit: line.unit,
				quantity: sign * line.quantity,
				ratePercent: line.ratePercent,
				taxable: sign * paise(line.taxableINR),
				cgst: sign * paise(line.cgstINR),
				sgst: sign * paise(line.sgstINR),
				igst: sign * paise(line.igstINR),
				tax: sign * paise(line.cgstINR + line.sgstINR + line.igstINR),
				total: sign * paise(line.totalINR),
			})),
		);
	}

	/** One row per document, with its cost of goods from its posting (a credit note's cost comes back). */
	private async invoiceRows(from: string, to: string, places: Map<string, string>): Promise<ReportRow[]> {
		const { invoices, notes } = await this.documents(from, to, places);
		const chart = await this.books.chart();
		let cogs: string | null = null;
		try {
			cogs = resolveRole(chart.ledgers, 'cost_of_goods_sold').id;
		} catch {
			cogs = null;
		}
		const costOf = async (voucherId: string | null) => {
			if (!cogs || !voucherId) return 0;
			const voucher = await this.books.getVoucher(voucherId);
			return (voucher?.lines ?? [])
				.filter((l) => l.ledgerId === cogs)
				.reduce((sum, l) => sum + l.debitPaise - l.creditPaise, 0);
		};
		const docs = [
			...invoices.map((doc) => ({ doc, kind: 'invoice', number: doc.number, sign: 1, order: doc.orderNumber })),
			...notes.map((doc) => ({ doc, kind: 'creditNote', number: doc.number ?? '', sign: -1, order: '' })),
		];
		return Promise.all(
			docs.map(async ({ doc, kind, number, sign, order }) => {
				const taxable = sign * paise(doc.taxableINR);
				const cost = await costOf(doc.voucherId);
				return {
					date: doc.date,
					month: doc.date.slice(0, 7),
					document: number,
					documentKind: kind,
					gstin: doc.gstin,
					location: places.get(doc.locationId) as string,
					buyer: doc.buyer.name,
					buyerGstin: doc.buyer.gstin ?? '',
					state: doc.buyer.stateCode,
					order,
					taxable,
					tax: sign * paise(doc.cgstINR + doc.sgstINR + doc.igstINR),
					total: sign * paise(doc.totalINR),
					cost,
					margin: taxable - cost,
				};
			}),
		);
	}

	private rows(dataset: ReportDataset, from: string, to: string, places: Map<string, string>) {
		if (dataset === 'ledgerLines') return this.ledgerLines(from, to, places);
		if (dataset === 'invoiceLines') return this.invoiceLines(from, to, places);
		if (dataset === 'auditLines') return this.auditLines(from, to);
		return this.invoiceRows(from, to, places);
	}

	/**
	 * Brief 26 AU2: the admin's audit records in the period (up to 5,000, newest first), one row per field changed,
	 * India's date and time, the module (the action's first part), and a numeric change's size in %.
	 */
	private async auditLines(from: string, to: string): Promise<ReportRow[]> {
		if (!this.audit) return [];
		const rows: ReportRow[] = [];
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const names = new Map<string, string>();
		for (let page = 1; page <= 25; page++) {
			const found = await this.audit.list({
				audience: 'admin',
				from: new Date(`${from}T00:00:00+05:30`).toISOString(),
				to: new Date(`${to}T23:59:59+05:30`).toISOString(),
				page,
				pageSize: 200,
			});
			for (const e of found.items) {
				const ist = new Date(Date.parse(e.createdAt) + 5.5 * 3_600_000).toISOString();
				const reason = typeof e.metadata['reason'] === 'string' ? (e.metadata['reason'] as string) : '';
				const base = {
					date: ist.slice(0, 10),
					month: ist.slice(0, 7),
					time: ist.slice(11, 16),
					weekday: days[new Date(ist).getUTCDay()] as string,
					who: await this.nameOf(e.actorUserId, names),
					module: e.action.split('.')[0] as string,
					action: e.action,
					record: `${e.entityType ?? ''} ${e.entityId ?? ''}`.trim(),
					reason,
					changes: 1,
				};
				const diffs = e.diffs.length ? e.diffs : [{ field: '', before: undefined, after: undefined }];
				for (const d of diffs) {
					const before = typeof d.before === 'number' ? d.before : null;
					const after = typeof d.after === 'number' ? d.after : null;
					rows.push({
						...base,
						field: d.field,
						before: d.before === undefined || d.before === null ? '' : String(d.before),
						after: d.after === undefined || d.after === null ? '' : String(d.after),
						changePercent:
							before !== null && after !== null && before !== 0
								? Math.round(((after - before) / before) * 1000) / 10
								: null,
					});
				}
			}
			if (page * 200 >= found.total) break;
		}
		return rows;
	}

	/** AU1: the person's name for the audit source (display name, else username, else email, else their id). */
	private async nameOf(id: string | null, names: Map<string, string>): Promise<string> {
		if (!id) return '';
		const known = names.get(id);
		if (known !== undefined) return known;
		const user = await this.admins.findById(id).catch(() => null);
		const name = user?.displayName || user?.username || user?.email || id;
		names.set(id, name);
		return name;
	}

	/** V1 preview, or a run: the table for the spec over the period. */
	async run(run: ReportRun, principal: AuthenticatedPrincipal | undefined): Promise<ReportTable> {
		if (run.from > run.to) throw refuse('report_period_backwards');
		if (run.spec.dataset === 'auditLines' && !mayAudit(principal))
			throw new ForbiddenException(accountsRefusal('report_audit_not_allowed'));
		const problems = specProblems(run.spec.dataset, run.spec);
		if (problems.length) throw refuse(problems[0] as string);
		const rows = await this.rows(run.spec.dataset, run.from, run.to, await this.visible(principal));
		return runReport(run.spec.dataset, rows, run.spec, run.preview ? PREVIEW_LIMIT : RUN_LIMIT);
	}

	/** Whether a person may open a saved report: its maker, a holder of one of its roles, or anyone when open to all. */
	private async mayOpen(
		definition: ReportDefinition,
		principal: AuthenticatedPrincipal | undefined,
	): Promise<boolean> {
		if (!principal) return false;
		if (definition.openTo === 'all' || definition.createdBy === principal.userId) return true;
		if (definition.openTo !== 'roles') return false;
		const mine = new Set((await this.assignments.listActiveForUser(principal.userId)).map((a) => a.roleId));
		return definition.roleIds.some((id) => mine.has(id));
	}

	/** U1 "Saved by you" and the folders: the saved reports this person may open. */
	async list(principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<ReportDefinition[]> {
		const all = await this.definitions.list();
		const open = await Promise.all(all.map((d) => this.mayOpen(d, principal)));
		return [...(mayAudit(principal) ? auditTemplates(now) : []), ...all.filter((_, i) => open[i])];
	}

	async get(id: string, principal: AuthenticatedPrincipal | undefined, now = new Date()): Promise<ReportDefinition> {
		if (id.startsWith(BUILT_IN_PREFIX)) {
			const template = auditTemplates(now).find((t) => t.id === id);
			if (!template) throw new NotFoundException(accountsRefusal('report_definition_not_found'));
			if (!mayAudit(principal)) throw new ForbiddenException(accountsRefusal('report_audit_not_allowed'));
			return template;
		}
		const definition = await this.definitions.get(id);
		if (!definition) throw new NotFoundException(accountsRefusal('report_definition_not_found'));
		if (!(await this.mayOpen(definition, principal)))
			throw new ForbiddenException(accountsRefusal('report_definition_not_yours'));
		return definition;
	}

	private checkSpec(write: ReportDefinitionWrite) {
		const problems = specProblems(write.spec.dataset, write.spec);
		if (problems.length) throw refuse(problems[0] as string);
		if (write.openTo === 'roles' && !write.roleIds.length) throw refuse('report_roles_needed');
	}

	/** V2 Save as template. */
	async create(
		write: ReportDefinitionWrite,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<ReportDefinition> {
		this.checkSpec(write);
		const user = principal ? await this.admins.findById(principal.userId).catch(() => null) : null;
		const definition: ReportDefinition = {
			...write,
			id: `rpt_${randomUUID()}`,
			createdBy: principal?.userId ?? null,
			createdByName: user?.displayName || user?.email || user?.username || principal?.userId || '',
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			version: 0,
		};
		await this.definitions.insert(definition);
		return definition;
	}

	/** Only its maker changes or deletes a saved report. */
	private async own(id: string, principal: AuthenticatedPrincipal | undefined): Promise<ReportDefinition> {
		if (id.startsWith(BUILT_IN_PREFIX)) throw new ForbiddenException(accountsRefusal('report_definition_built_in'));
		const definition = await this.definitions.get(id);
		if (!definition) throw new NotFoundException(accountsRefusal('report_definition_not_found'));
		if (!principal || definition.createdBy !== principal.userId)
			throw new ForbiddenException(accountsRefusal('report_definition_not_yours'));
		return definition;
	}

	async update(
		id: string,
		write: ReportDefinitionEdit,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<ReportDefinition> {
		const current = await this.own(id, principal);
		const { version, ...fields } = write;
		this.checkSpec(fields);
		try {
			return await this.definitions.save({ ...current, ...fields, updatedAt: now.toISOString() }, version);
		} catch (error) {
			if (error instanceof Error && error.message === 'report_definition_changed')
				throw new ConflictException(accountsRefusal('report_definition_changed'));
			throw error;
		}
	}

	async remove(id: string, principal: AuthenticatedPrincipal | undefined): Promise<void> {
		await this.own(id, principal);
		await this.definitions.remove(id);
	}
}
