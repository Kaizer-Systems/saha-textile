import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	Optional,
} from '@nestjs/common';
import {
	type AdminCurrencyRow,
	type AdminFxOverview,
	type AuditLog,
	type Currency,
	type CurrencyRateWrite,
	type FxFetchResult,
	type FxSettingsWrite,
	LAUNCH_CURRENCIES,
	LAUNCH_CURRENCY_SYMBOLS,
} from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AdminUserRoleAssignmentRepository,
	type AuditLogRepository,
	type CurrencyRepository,
	type FxRatePort,
	type RoleRepository,
	type SiteSettingsRepository,
	SUPER_ADMIN_ROLE_KEY,
	foreignAmountFromINR,
	inrPerUnitOf,
	rateFromInrPerUnit,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CURRENCY_REPOSITORY,
	ROLE_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
} from '../infra/tokens';
import { codedRefusal } from '../common/coded-refusal';
import { fetchRatesNow, readFxSettings } from './fx-fetch';

export const FX_RATE_PORT = Symbol('FxRatePort');
/** The FX port and whether it reads with a key (the admin names the endpoint the fetch uses). */
export type FxRateSource = FxRatePort & { readonly usesKey?: boolean };

/** What the example column prices (brief fx01: "₹10,000 → US$119.88"). */
export const EXAMPLE_INR = 10_000;
const HOME_CURRENCY = 'INR';

const refuse = (code: string, path: string, message: string) =>
	new BadRequestException({ issues: [{ path, message, code }] });

/**
 * Admin › Currencies (shipping rules brief fx01–fx03): the rate source, the PayPal markup (super
 * admin only), the daily fetch and each currency's stored rate. Every change is audited; settings
 * name the revision they started from and a clash is refused.
 */
@Injectable()
export class FxAdminService {
	constructor(
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(CURRENCY_REPOSITORY) private readonly currencies: CurrencyRepository,
		@Inject(FX_RATE_PORT) private readonly fx: FxRateSource,
		@Inject(ROLE_REPOSITORY) private readonly roles: Pick<RoleRepository, 'findByKey'>,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'findActive'>,
		@Optional()
		@Inject(ADMIN_USER_REPOSITORY)
		private readonly admins: Pick<AdminUserRepository, 'findById'> | null = null,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	/** A super admin holds the system Administrator role. */
	async isSuperAdmin(userId: string | null): Promise<boolean> {
		if (!userId) return false;
		const role = await this.roles.findByKey(SUPER_ADMIN_ROLE_KEY);
		return !!role && !!(await this.assignments.findActive(userId, role.id));
	}

	async overview(actor: string | null): Promise<AdminFxOverview> {
		const [settings, stored, canEditMarkup] = await Promise.all([
			readFxSettings(this.settings),
			this.currencies.listAll(),
			this.isSuperAdmin(actor),
		]);
		const byCode = new Map(stored.map((c) => [c.code, c]));
		const codes = [
			...LAUNCH_CURRENCIES,
			...stored
				.map((c) => c.code)
				.filter((code) => code !== HOME_CURRENCY && !(LAUNCH_CURRENCIES as readonly string[]).includes(code))
				.sort(),
		];
		const names = await this.names(stored.map((c) => c.rateSetById));
		const rows: AdminCurrencyRow[] = codes.map((code) => {
			const currency = byCode.get(code);
			const launchSymbol = LAUNCH_CURRENCY_SYMBOLS[code as (typeof LAUNCH_CURRENCIES)[number]];
			if (!currency)
				return {
					code,
					symbol: launchSymbol ?? code,
					stored: false,
					enabled: false,
					inrPerUnit: null,
					setBy: null,
					setByName: null,
					setAt: null,
					examplePrice: null,
				};
			return {
				code,
				symbol: currency.symbol,
				stored: true,
				enabled: currency.enabled,
				inrPerUnit: inrPerUnitOf(currency.rateFromINR),
				setBy: currency.rateSetBy ?? null,
				setByName: currency.rateSetById ? (names.get(currency.rateSetById) ?? null) : null,
				setAt: currency.rateSetAt ?? currency.updatedAt ?? null,
				examplePrice: foreignAmountFromINR(EXAMPLE_INR, currency.rateFromINR, settings.paypalMarkupPercent),
			};
		});
		return {
			settings,
			currencies: rows,
			canEditMarkup,
			exampleINR: EXAMPLE_INR,
			fetchUsesKey: Boolean(this.fx.usesKey),
		};
	}

	async saveSettings(input: FxSettingsWrite, actor: string | null): Promise<AdminFxOverview> {
		const current = await readFxSettings(this.settings);
		if (input.revision !== current.revision)
			throw new ConflictException(
				codedRefusal('stale_revision', 'Someone else changed these settings first', 'revision'),
			);
		if (input.paypalMarkupPercent !== current.paypalMarkupPercent && !(await this.isSuperAdmin(actor)))
			throw new ForbiddenException(
				codedRefusal('super_admin_only', 'Only a super admin can change the markup', 'paypalMarkupPercent'),
			);
		if (input.source === 'paypalFxaas' && !current.paypalFxaas.approved)
			throw refuse('fxaas_not_approved', 'source', 'PayPal has not approved its own rates for this account yet');
		const at = new Date().toISOString();
		await this.settings.set('fx', {
			...current,
			source: input.source,
			paypalMarkupPercent: input.paypalMarkupPercent,
			dailyFetch: { ...current.dailyFetch, enabled: input.dailyFetch.enabled, time: input.dailyFetch.time },
			revision: current.revision + 1,
			updatedAt: at,
			updatedBy: actor,
		});
		await this.record(actor, 'fx.settings.update', null, {
			source: { from: current.source, to: input.source },
			markup: { from: current.paypalMarkupPercent, to: input.paypalMarkupPercent },
			dailyFetch: {
				from: { enabled: current.dailyFetch.enabled, time: current.dailyFetch.time },
				to: input.dailyFetch,
			},
		});
		return this.overview(actor);
	}

	/** Typing a rate (₹ per unit) replaces the stored one until the next daily fetch, if it is on. */
	async setRate(rawCode: string, input: CurrencyRateWrite, actor: string | null): Promise<AdminFxOverview> {
		const code = rawCode.trim().toUpperCase();
		if (!/^[A-Z]{3}$/.test(code)) throw refuse('unknown_currency', 'code', 'A currency is three letters');
		if (code === HOME_CURRENCY) throw refuse('home_currency', 'code', 'The shop’s own currency has no rate');
		const existing = await this.currencies.findByCode(code);
		if (!existing && input.inrPerUnit === undefined)
			throw refuse('rate_required', 'inrPerUnit', 'Type a rate before switching this currency on');
		const at = new Date().toISOString();
		const typed = input.inrPerUnit !== undefined;
		const next: Currency = {
			code,
			symbol: existing?.symbol ?? LAUNCH_CURRENCY_SYMBOLS[code as (typeof LAUNCH_CURRENCIES)[number]] ?? code,
			enabled: input.enabled ?? existing?.enabled ?? true,
			rateFromINR: typed ? rateFromInrPerUnit(input.inrPerUnit as number) : (existing as Currency).rateFromINR,
			paypalActive: existing?.paypalActive ?? true,
			paypalPct: existing?.paypalPct ?? 0,
			paypalFixed: existing?.paypalFixed ?? 0,
			rateSetBy: typed ? 'staff' : (existing?.rateSetBy ?? null),
			rateSetById: typed ? actor : (existing?.rateSetById ?? null),
			rateSetAt: typed ? at : (existing?.rateSetAt ?? null),
		};
		await this.currencies.upsert(next);
		await this.record(actor, 'fx.currency.update', code, {
			inrPerUnit: typed
				? { from: existing ? inrPerUnitOf(existing.rateFromINR) : null, to: input.inrPerUnit }
				: undefined,
			enabled: input.enabled !== undefined ? { from: existing?.enabled ?? false, to: input.enabled } : undefined,
		});
		return this.overview(actor);
	}

	async fetchNow(actor: string | null): Promise<FxFetchResult> {
		const result = await fetchRatesNow({ settings: this.settings, currencies: this.currencies, fx: this.fx });
		await this.record(actor, 'fx.fetch', null, { ok: result.ok, updated: result.updated, problem: result.problem });
		return result;
	}

	private async names(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
		const out = new Map<string, string>();
		if (!this.admins) return out;
		const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
		await Promise.all(
			wanted.map(async (id) => {
				const admin = await this.admins?.findById(id).catch(() => null);
				const name = admin?.displayName?.trim() || admin?.username || admin?.email?.split('@')[0];
				if (name) out.set(id, name);
			}),
		);
		return out;
	}

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string | null,
		metadata: Record<string, unknown>,
	) {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'currency',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
