import { Inject, Injectable } from '@nestjs/common';
import type {
	AgeingSide,
	AuditChip,
	AuditReport,
	AuditReportQuery,
	AuditReportRow,
	OutstandingAgeing,
} from '@saha-textile/contracts';
import {
	SUPER_ADMIN_ROLE_KEY,
	ageingBuckets,
	auditCategories,
	istDay,
	isBooksAudit,
	type AdminOrderRepository,
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type BusinessRepository,
	type PurchaseEntryRepository,
	type RoleRepository,
} from '@saha-textile/core-domain';

import {
	ADMIN_ORDER_REPOSITORY,
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	BUSINESS_REPOSITORY,
	PURCHASE_ENTRY_REPOSITORY,
	ROLE_REPOSITORY,
} from '../infra/tokens';

const paise = (inr: number) => Math.round(inr * 100);
/** The most audit entries one report reads (narrow the period beyond this). */
const MAX_AUDIT = 10_000;
const CHIPS: readonly AuditChip[] = ['all', 'edits', 'backdated', 'cancelled', 'unlocks', 'takeovers', 'superAdmin'];

/** IST midnight of a day, as an instant. */
const istStart = (day: string) => new Date(Date.parse(`${day}T00:00:00+05:30`)).toISOString();
const istEnd = (day: string) => new Date(Date.parse(`${day}T23:59:59.999+05:30`)).toISOString();

/**
 * Outstanding with ageing (accounts brief U5) and the audit report (U8). Business customers owe what their orders on
 * account still owe, by due day; suppliers are owed what their posted bills still owe. The audit report lists every
 * change across the books in a period, by kind, with who made it.
 */
@Injectable()
export class BooksReportsService {
	constructor(
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: Pick<BusinessRepository, 'list'>,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'listOpenOnAccount'>,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: Pick<PurchaseEntryRepository, 'openPayables'>,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: Pick<AuditLogRepository, 'list'>,
		@Inject(ROLE_REPOSITORY) private readonly roles: Pick<RoleRepository, 'findByKey'>,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'listActiveForRole'>,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
	) {}

	/** U5: each party's dues by age on today's date, largest first. */
	async ageing(side: AgeingSide, now = new Date()): Promise<OutstandingAgeing> {
		const asAt = istDay(now);
		const parties: { partyId: string; name: string; rows: { dueOn: string; duePaise: number }[] }[] = [];
		if (side === 'customers') {
			for (let page = 1; ; page += 1) {
				const found = await this.businesses.list({ role: 'all', page, pageSize: 100 });
				for (const b of found.items) {
					const open = await this.orders.listOpenOnAccount(b.id);
					if (open.length)
						parties.push({
							partyId: b.id,
							name: b.tradeName || b.legalName,
							rows: open.map((o) => ({
								dueOn: o.dueOn ?? o.placedAt.slice(0, 10),
								duePaise: paise(o.dueINR),
							})),
						});
				}
				if (page * 100 >= found.total || !found.items.length) break;
			}
		} else {
			const bySupplier = new Map<string, (typeof parties)[number]>();
			for (const e of await this.entries.openPayables()) {
				const party = bySupplier.get(e.supplierId) ?? { partyId: e.supplierId, name: e.supplierName, rows: [] };
				party.rows.push({ dueOn: e.dueOn, duePaise: paise(e.totals.totalINR - e.paidINR - e.creditedINR) });
				bySupplier.set(e.supplierId, party);
			}
			parties.push(...bySupplier.values());
		}
		const rows = parties
			.map((p) => ({ partyId: p.partyId, name: p.name, ...ageingBuckets(p.rows, asAt) }))
			.filter((r) => r.total > 0)
			.sort((a, b) => b.total - a.total);
		const totals = rows.reduce(
			(sum, r) => ({
				notDue: sum.notDue + r.notDue,
				days1to30: sum.days1to30 + r.days1to30,
				days31to60: sum.days31to60 + r.days31to60,
				days61to90: sum.days61to90 + r.days61to90,
				over90: sum.over90 + r.over90,
				total: sum.total + r.total,
			}),
			{ notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 },
		);
		return { side, asAt, rows, totals };
	}

	/** The users holding the super admin role now. */
	private async superAdmins(): Promise<Set<string>> {
		const role = await this.roles.findByKey(SUPER_ADMIN_ROLE_KEY);
		if (!role) return new Set();
		return new Set((await this.assignments.listActiveForRole(role.id)).map((a) => a.userId));
	}

	/** U8: the books' changes in the period, by chip, searched, one page at a time; counts per chip. */
	async auditReport(query: AuditReportQuery): Promise<AuditReport> {
		const entries = [];
		for (let page = 1; ; page += 1) {
			const found = await this.audit.list({
				from: istStart(query.from),
				to: istEnd(query.to),
				page,
				pageSize: 200,
			});
			entries.push(...found.items.filter(isBooksAudit));
			if (page * 200 >= found.total || !found.items.length || page * 200 >= MAX_AUDIT) break;
		}
		const supers = await this.superAdmins();
		const names = new Map<string, string>();
		const nameOf = async (id: string | null) => {
			if (!id) return '';
			if (!names.has(id)) {
				const user = await this.admins.findById(id).catch(() => null);
				names.set(id, user?.displayName || user?.email || user?.username || id);
			}
			return names.get(id) as string;
		};
		const rows: AuditReportRow[] = [];
		for (const e of entries) {
			const reason = typeof e.metadata['reason'] === 'string' ? ` · ${e.metadata['reason']}` : '';
			rows.push({
				id: e.id,
				at: e.createdAt,
				who: await nameOf(e.actorUserId),
				action: e.action,
				entityType: e.entityType,
				entityId: e.entityId,
				detail:
					e.diffs
						.map((d) => `${d.field}: ${String(d.before ?? '—')} → ${String(d.after ?? '—')}`)
						.join('; ') + reason,
				categories: auditCategories(e, supers),
			});
		}
		const words = query.q?.toLowerCase();
		const searched = words
			? rows.filter((r) =>
					[r.who, r.action, r.entityId ?? '', r.detail].some((text) => text.toLowerCase().includes(words)),
				)
			: rows;
		const counts = Object.fromEntries(
			CHIPS.map((chip) => [
				chip,
				chip === 'all' ? searched.length : searched.filter((r) => r.categories.includes(chip)).length,
			]),
		) as AuditReport['counts'];
		const chosen =
			query.chip === 'all' ? searched : searched.filter((r) => r.categories.includes(query.chip as never));
		const sorted = [...chosen].sort((a, b) => b.at.localeCompare(a.at));
		const start = (query.page - 1) * query.pageSize;
		return { rows: sorted.slice(start, start + query.pageSize), total: sorted.length, counts };
	}
}
