import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	Gstr2bDecision,
	Gstr2bImport,
	Gstr2bImportWrite,
	Gstr2bQuery,
	Gstr2bRow,
	Gstr2bView,
} from '@saha-textile/contracts';
import {
	claimFrom2b,
	countResults,
	defaultStockLocation,
	lastClaimMonth,
	normalizeBillNumber,
	parseGstr2b,
	reconcile2b,
	type AdminUserRepository,
	type BooksBill,
	type CompanyRepository,
	type GstReturnRepository,
	type Gstr2bRepository,
	type LocationRepository,
	type PurchaseEntryRepository,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import {
	ADMIN_USER_REPOSITORY,
	COMPANY_REPOSITORY,
	GST_RETURN_REPOSITORY,
	GSTR2B_REPOSITORY,
	LOCATION_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * GSTR-2B against our purchases (accounts brief G5). The 2B file downloaded from the portal is imported per GSTIN and
 * month; every look matches it again to our posted bills (nothing is written until someone records what was done on the
 * portal for a line). The credit GSTR-3B may claim is the accepted lines' credit (core `claimFrom2b`). Once the month's
 * GSTR-3B is filed, its 2B can't change.
 */
@Injectable()
export class Gstr2bService {
	constructor(
		@Inject(GSTR2B_REPOSITORY) private readonly imports: Gstr2bRepository,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getRegistration'>,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: Pick<PurchaseEntryRepository, 'postedBetween'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(GST_RETURN_REPOSITORY) private readonly filings: Pick<GstReturnRepository, 'list'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
	) {}

	private async registration(id: string) {
		const registration = await this.company.getRegistration(id);
		if (!registration) throw new NotFoundException(accountsRefusal('gst_registration_unknown'));
		return registration;
	}

	/** True once the month's GSTR-3B is filed for the GSTIN. */
	private async locked(gstRegistrationId: string, month: string): Promise<boolean> {
		return (await this.filings.list()).some(
			(f) => f.gstRegistrationId === gstRegistrationId && f.returnType === 'GSTR-3B' && f.month === month,
		);
	}

	private async nameOf(principal: AuthenticatedPrincipal | undefined): Promise<string> {
		if (!principal) return '';
		const user = await this.admins.findById(principal.userId).catch(() => null);
		return user?.displayName || user?.email || user?.username || principal.userId;
	}

	/**
	 * Our bills that may show in this month's 2B: posted with credit, from a supplier with a GSTIN, dated by the month's
	 * end and still within the s.16(4) time limit, not already found in an earlier month's 2B. Purchases post at the
	 * stock location, so only its GSTIN has them.
	 */
	async booksBills(gstRegistrationId: string, month: string): Promise<BooksBill[]> {
		const locations = await this.locations.list();
		const stock = locations.find((l) => l.id === defaultStockLocation(locations));
		if (!stock || stock.gstRegistrationId !== gstRegistrationId) return [];
		const from = `${Number(month.slice(0, 4)) - 2}-04-01`;
		const earlier = (await this.imports.listForRegistration(gstRegistrationId)).filter((i) => i.month < month);
		const seen = new Set(earlier.flatMap((i) => i.lines.filter((l) => l.kind === 'invoice').map((l) => l.key)));
		return (await this.entries.postedBetween(from, monthEnd(month)))
			.filter((e) => e.itcClaimable && e.supplierGstin && lastClaimMonth(e.billDate) >= month)
			.map((e) => ({
				entryId: e.id,
				entryNumber: e.number ?? '',
				supplierGstin: (e.supplierGstin as string).toUpperCase(),
				supplierName: e.supplierName,
				billNumber: e.billNumber,
				billDate: e.billDate,
				taxable: paise(e.totals.taxableINR),
				igst: paise(e.totals.igstINR),
				cgst: paise(e.totals.cgstINR),
				sgst: paise(e.totals.sgstINR),
			}))
			.filter((b) => b.igst + b.cgst + b.sgst > 0)
			.filter((b) => !seen.has(`${b.supplierGstin}|invoice|${normalizeBillNumber(b.billNumber)}`));
	}

	/** The month's rows (every result), the import they come from, and whether the month is locked. */
	async rows(gstRegistrationId: string, month: string): Promise<{ doc: Gstr2bImport | null; rows: Gstr2bRow[] }> {
		const [doc, bills] = await Promise.all([
			this.imports.find(gstRegistrationId, month),
			this.booksBills(gstRegistrationId, month),
		]);
		return { doc, rows: reconcile2b(doc?.lines ?? [], bills, doc?.decisions ?? {}) };
	}

	/** G5: the month's 2B against our bills, one chip at a time, with the credit 3B may claim. */
	async view(query: Gstr2bQuery): Promise<Gstr2bView> {
		const registration = await this.registration(query.gstRegistrationId);
		const [{ doc, rows }, locked] = await Promise.all([
			this.rows(registration.id, query.month),
			this.locked(registration.id, query.month),
		]);
		return {
			gstin: registration.gstin,
			month: query.month,
			importId: doc?.id ?? null,
			importedAt: doc?.importedAt ?? null,
			importedByName: doc?.importedByName ?? '',
			generatedOn: doc?.generatedOn ?? null,
			notRead: doc?.notRead ?? [],
			counts: countResults(rows),
			rows: query.chip === 'all' ? rows : rows.filter((r) => r.result === query.chip),
			claim: claimFrom2b(rows),
			locked,
			version: doc?.version ?? 0,
		};
	}

	/**
	 * Import (or import again) the portal's 2B file for its month. It must be this GSTIN's; what was recorded for lines
	 * still in the new file is kept.
	 */
	async import(write: Gstr2bImportWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		const registration = await this.registration(write.gstRegistrationId);
		let parsed: ReturnType<typeof parseGstr2b>;
		try {
			parsed = parseGstr2b(write.file);
		} catch (error) {
			throw refuse(error instanceof Error ? error.message : 'gstr2b_file_unreadable');
		}
		if (parsed.gstin !== registration.gstin) throw refuse('gstr2b_other_gstin');
		if (await this.locked(registration.id, parsed.month)) throw refuse('gstr2b_month_filed');
		const existing = await this.imports.find(registration.id, parsed.month);
		const keys = new Set(parsed.lines.map((l) => l.key));
		const decisions = Object.fromEntries(
			Object.entries(existing?.decisions ?? {}).filter(([key]) => keys.has(key)),
		) as Gstr2bImport['decisions'];
		const doc: Gstr2bImport = {
			id: existing?.id ?? `g2b_${randomUUID()}`,
			gstRegistrationId: registration.id,
			gstin: registration.gstin,
			month: parsed.month,
			generatedOn: parsed.generatedOn,
			lines: parsed.lines,
			notRead: parsed.notRead,
			decisions,
			importedBy: principal?.userId ?? null,
			importedByName: await this.nameOf(principal),
			importedAt: now.toISOString(),
			version: existing?.version ?? 0,
		};
		await this.save(doc, existing ? existing.version : null);
		return this.view({ gstRegistrationId: registration.id, month: parsed.month, chip: 'all' });
	}

	/** What was done on the portal (IMS) for one of 2B's lines. */
	async decide(write: Gstr2bDecision): Promise<Gstr2bView> {
		const registration = await this.registration(write.gstRegistrationId);
		const doc = await this.imports.find(registration.id, write.month);
		if (!doc) throw refuse('gstr2b_not_imported');
		if (await this.locked(registration.id, write.month)) throw refuse('gstr2b_month_filed');
		if (!doc.lines.some((l) => l.key === write.key)) throw refuse('gstr2b_line_unknown');
		await this.save({ ...doc, decisions: { ...doc.decisions, [write.key]: write.action } }, write.version);
		return this.view({ gstRegistrationId: registration.id, month: write.month, chip: 'all' });
	}

	private async save(doc: Gstr2bImport, expectedVersion: number | null) {
		try {
			return await this.imports.save(doc, expectedVersion);
		} catch (error) {
			if (error instanceof Error && (error.message === 'gstr2b_changed' || error.message === 'gstr2b_exists'))
				throw new ConflictException(accountsRefusal('gstr2b_changed'));
			throw error;
		}
	}
}
