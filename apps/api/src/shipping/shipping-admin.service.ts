import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	type AdminShippingOverview,
	type AdminShippingRuleSetDetail,
	type AdminShippingRuleSetRow,
	type AuditLog,
	BUILT_ABROAD_ORDER_POLICIES,
	type ShippingException,
	type ShippingExceptionWrite,
	type ShippingOverviewCheck,
	type ShippingRuleSet,
	type ShippingRuleSetActivate,
	type ShippingRuleSetActivateResult,
	type ShippingRuleSetCreate,
	type ShippingRuleSetSave,
	type ShippingRuleSetUsage,
	ShippingSettings,
	type ShippingSettingsWrite,
	type ShippingTestCart,
	type ShippingTestCartChange,
	type ShippingTryRequest,
	type ShippingTryResult,
	type ShippingZoneMethod,
} from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type CategoryRepository,
	type ProductRepository,
	type ShippingRuleRepository,
	evaluateShippingRuleSet,
	shippingZoneFor,
	validateShippingRuleSet,
} from '@saha-textile/core-domain';

import {
	AUDIT_LOG_REPOSITORY,
	CATEGORY_REPOSITORY,
	PRODUCT_REPOSITORY,
	SHIPPING_RULE_REPOSITORY,
} from '../infra/tokens';
import { LanguageStore } from '../languages/language-store';
import { ShippingSnapshotService } from './shipping-snapshot.service';

/** What a shop starts from before its zone settings are first saved. */
export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = ShippingSettings.parse({
	domestic: { kind: 'ruleSet', ruleSetId: null },
	international: { kind: 'ruleSet', ruleSetId: null },
	defaultCharges: { domestic: 0, internationalFirst: 0, internationalFurther: 0 },
});

/** Try it lists this many lines; a bigger cart says "and N more". */
const TRY_LINES_SHOWN = 20;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Shipping › Overview, Rule sets and Where rules apply (brief approved 2026-11-19). Every write
 * names the revision it started from, is refused on a clash, and is audited. Pre-made rule sets
 * are locked: they can be viewed, tried and copied, never changed or deleted.
 */
@Injectable()
export class ShippingAdminService {
	constructor(
		@Inject(SHIPPING_RULE_REPOSITORY) private readonly rules: ShippingRuleRepository,
		@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
		private readonly snapshots: ShippingSnapshotService,
		private readonly languages: LanguageStore,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	/* ------------------------------------------------------------------ rule sets */

	async list(): Promise<AdminShippingRuleSetRow[]> {
		const [ruleSets, settings, exceptions] = await Promise.all([
			this.rules.listRuleSets(),
			this.settings(),
			this.rules.listExceptions(),
		]);
		return ruleSets.map((ruleSet) => ({ ruleSet, usage: usageOf(ruleSet.id, settings, exceptions) }));
	}

	async detail(id: string): Promise<AdminShippingRuleSetDetail> {
		const ruleSet = await this.require(id);
		const [settings, exceptions, versions] = await Promise.all([
			this.settings(),
			this.rules.listExceptions(),
			this.rules.listVersions(id),
		]);
		const check = validateShippingRuleSet(ruleSet.draft, ruleSet.use, { languages: this.languages.shop() });
		return {
			ruleSet,
			usage: usageOf(id, settings, exceptions),
			versions: versions.map((v) => ({
				version: v.version,
				activatedAt: v.activatedAt,
				activatedBy: v.activatedBy,
			})),
			issues: check.issues,
			canActivate: check.canActivate,
		};
	}

	async create(input: ShippingRuleSetCreate, actor: string | null): Promise<AdminShippingRuleSetDetail> {
		const source = input.copyFromId ? await this.require(input.copyFromId) : null;
		const now = new Date().toISOString();
		const ruleSet: ShippingRuleSet = {
			id: `rs_${randomUUID()}`,
			name: input.name,
			description: input.description,
			use: input.use,
			kind: 'own',
			premadeKey: null,
			copiedFromId: source?.id ?? null,
			activeVersion: null,
			draft: source?.draft ?? { steps: [], adjust: [] },
			hasDraftChanges: true,
			testCarts: source?.testCarts ?? [],
			revision: 0,
			createdAt: now,
			updatedAt: now,
			updatedBy: actor,
		};
		await this.rules.createRuleSet(ruleSet);
		await this.record(actor, 'shipping_rule_set.create', ruleSet.id, { copiedFromId: ruleSet.copiedFromId });
		return this.detail(ruleSet.id);
	}

	/** Saves the working copy. The active version, if any, keeps pricing checkout until the next activation. */
	async save(id: string, input: ShippingRuleSetSave, actor: string | null): Promise<AdminShippingRuleSetDetail> {
		const current = await this.requireOwn(id);
		if (input.revision !== current.revision) throw this.clash(current);
		const active = current.activeVersion === null ? null : await this.rules.findVersion(id, current.activeVersion);
		const next: ShippingRuleSet = {
			...current,
			name: input.name,
			description: input.description,
			use: input.use,
			draft: input.draft,
			testCarts: input.testCarts,
			hasDraftChanges: active === null || !same(active.body, input.draft),
			revision: current.revision + 1,
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		};
		if (!(await this.rules.saveRuleSet(next, current.revision))) throw this.clash(await this.require(id));
		await this.record(actor, 'shipping_rule_set.save', id, { revision: next.revision });
		return this.detail(id);
	}

	/**
	 * Makes the saved working copy the active version, after the checks and every saved test cart.
	 * A test cart whose amount changes must be accepted by name; one that would no longer price
	 * (can't ship, no result, courier) blocks until it is changed or removed.
	 */
	async activate(
		id: string,
		input: ShippingRuleSetActivate,
		actor: string | null,
	): Promise<ShippingRuleSetActivateResult> {
		const current = await this.requireOwn(id);
		if (input.revision !== current.revision) throw this.clash(current);
		const check = validateShippingRuleSet(current.draft, current.use, { languages: this.languages.shop() });
		if (!check.canActivate) return { outcome: 'invalid', issues: check.issues };

		const settings = await this.settings();
		const changes: ShippingTestCartChange[] = [];
		const testCarts: ShippingTestCart[] = [];
		for (const cart of current.testCarts) {
			const priced = await this.priceTestCart(current, cart, settings);
			const accepted = input.acceptChanges.find((a) => a.testCartId === cart.id);
			const unchanged = priced.status === 'priced' && priced.amountINR === cart.expectedINR;
			if (unchanged) {
				testCarts.push(cart);
			} else if (priced.status === 'priced' && accepted && accepted.toINR === priced.amountINR) {
				testCarts.push({ ...cart, expectedINR: priced.amountINR });
			} else {
				changes.push({
					testCartId: cart.id,
					name: cart.name,
					fromINR: cart.expectedINR,
					toINR: priced.amountINR,
					status: priced.status,
				});
			}
		}
		if (changes.length > 0) return { outcome: 'testCartsChanged', changes };

		const versions = await this.rules.listVersions(id);
		const version = Math.max(0, ...versions.map((v) => v.version)) + 1;
		const now = new Date().toISOString();
		const acceptedChanges = current.testCarts.flatMap((cart) => {
			const after = testCarts.find((c) => c.id === cart.id);
			return after && after.expectedINR !== cart.expectedINR && after.expectedINR !== null
				? [{ testCartId: cart.id, fromINR: cart.expectedINR, toINR: after.expectedINR }]
				: [];
		});
		const next: ShippingRuleSet = {
			...current,
			activeVersion: version,
			hasDraftChanges: false,
			testCarts,
			revision: current.revision + 1,
			updatedAt: now,
			updatedBy: actor,
		};
		const saved = await this.rules.activate(
			next,
			{ ruleSetId: id, version, body: current.draft, activatedAt: now, activatedBy: actor, acceptedChanges },
			current.revision,
		);
		if (!saved) throw this.clash(await this.require(id));
		await this.record(actor, 'shipping_rule_set.activate', id, { version, acceptedChanges });
		return { outcome: 'activated', version, detail: await this.detail(id) };
	}

	async remove(id: string, revision: number, actor: string | null): Promise<void> {
		const current = await this.requireOwn(id);
		const [settings, exceptions] = await Promise.all([this.settings(), this.rules.listExceptions()]);
		const usage = usageOf(id, settings, exceptions);
		if (usage.zones.length > 0 || usage.exceptionIds.length > 0) {
			throw new ConflictException({
				code: 'rule_set_in_use',
				message: 'Change where this rule set is used first',
				usage,
			});
		}
		if (revision !== current.revision || !(await this.rules.deleteRuleSet(id, revision)))
			throw this.clash(await this.require(id));
		await this.record(actor, 'shipping_rule_set.delete', id, { name: current.name });
	}

	/** Prices a body on real products without saving anything (the builder's Try it). */
	async tryRuleSet(input: ShippingTryRequest): Promise<ShippingTryResult> {
		const settings = await this.settings();
		const { snapshot, views } = await this.snapshots.build(
			input.lines,
			input.delivery,
			input.shopper,
			settings.defaultCharges,
		);
		const zone = shippingZoneFor(snapshot.delivery.country, settings.homeCountry);
		const outcome = evaluateShippingRuleSet({ body: input.body, snapshot, zone });
		return {
			status: outcome.status,
			zone,
			amountINR: outcome.status === 'priced' ? outcome.amountINR : null,
			lines: views.slice(0, TRY_LINES_SHOWN),
			trace: outcome.trace,
			adjustments: outcome.status === 'priced' ? outcome.adjustments : [],
			cantShip: outcome.status === 'cantShip' ? outcome.lines : [],
			noResult: outcome.status === 'noResult' ? outcome.where : [],
			moreLines: Math.max(0, views.length - TRY_LINES_SHOWN),
		};
	}

	/* ------------------------------------------------------------------ settings and overview */

	async overview(): Promise<AdminShippingOverview> {
		const [stored, ruleSets, exceptions] = await Promise.all([
			this.rules.getSettings(),
			this.rules.listRuleSets(),
			this.rules.listExceptions(),
		]);
		const settings = stored ?? DEFAULT_SHIPPING_SETTINGS;
		return {
			settings: stored,
			defaults: DEFAULT_SHIPPING_SETTINGS,
			ruleSets: ruleSets.map((r) => ({ id: r.id, name: r.name, use: r.use, activeVersion: r.activeVersion })),
			exceptionCount: exceptions.length,
			checks: overviewChecks(settings, ruleSets, exceptions),
			abroadPolicies: [...BUILT_ABROAD_ORDER_POLICIES],
		};
	}

	async saveSettings(input: ShippingSettingsWrite, actor: string | null): Promise<AdminShippingOverview> {
		const stored = await this.rules.getSettings();
		const revision = stored?.revision ?? 0;
		if (input.revision !== revision)
			throw new ConflictException({
				code: 'stale_revision',
				updatedBy: stored?.updatedBy ?? null,
				updatedAt: stored?.updatedAt ?? null,
			});
		if (!(BUILT_ABROAD_ORDER_POLICIES as readonly string[]).includes(input.abroadPolicy)) {
			throw new BadRequestException({
				issues: [
					{
						path: 'abroadPolicy',
						message: 'That path is not available yet',
						code: 'abroad_policy_not_built',
					},
				],
			});
		}
		for (const [zone, method] of [
			['domestic', input.domestic],
			['international', input.international],
		] as const) {
			await this.assertMethod(zone, method);
		}
		const next: ShippingSettings = {
			...input,
			revision: revision + 1,
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		};
		if (!(await this.rules.saveSettings(next, revision))) throw new ConflictException({ code: 'stale_revision' });
		await this.record(actor, 'shipping_settings.save', 'zones', {
			domestic: input.domestic,
			international: input.international,
			mixedRuleSets: input.mixedRuleSets,
			abroadPolicy: input.abroadPolicy,
		});
		return this.overview();
	}

	/* ------------------------------------------------------------------ exceptions */

	listExceptions(): Promise<ShippingException[]> {
		return this.rules.listExceptions();
	}

	async saveException(
		id: string | null,
		input: ShippingExceptionWrite,
		actor: string | null,
	): Promise<ShippingException> {
		if (id !== null && !(await this.rules.listExceptions()).some((e) => e.id === id))
			throw new NotFoundException('Exception not found');
		if (input.target.kind === 'category' && !(await this.categories.findById(input.target.categoryId))) {
			throw new BadRequestException({
				issues: [{ path: 'target.categoryId', message: 'Category not found', code: 'unknown_category' }],
			});
		}
		if (input.target.kind === 'product' && !(await this.products.findById(input.target.productId, 'admin'))) {
			throw new BadRequestException({
				issues: [{ path: 'target.productId', message: 'Product not found', code: 'unknown_product' }],
			});
		}
		for (const [path, choice] of [
			['domestic', input.domestic],
			['international', input.international],
		] as const) {
			if (choice.kind !== 'ruleSet') continue;
			const ruleSet = await this.rules.findRuleSet(choice.ruleSetId);
			if (!ruleSet || ruleSet.activeVersion === null) {
				throw new BadRequestException({
					issues: [
						{
							path: `${path}.ruleSetId`,
							message: 'Choose a rule set that is active',
							code: 'rule_set_not_active',
						},
					],
				});
			}
		}
		const exception: ShippingException = {
			id: id ?? `se_${randomUUID()}`,
			...input,
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		};
		await this.rules.saveException(exception);
		await this.record(actor, id ? 'shipping_exception.update' : 'shipping_exception.create', exception.id, {
			target: input.target,
		});
		return exception;
	}

	async removeException(id: string, actor: string | null): Promise<void> {
		if (!(await this.rules.deleteException(id))) throw new NotFoundException('Exception not found');
		await this.record(actor, 'shipping_exception.delete', id, {});
	}

	/* ------------------------------------------------------------------ helpers */

	private async settings(): Promise<ShippingSettings> {
		return (await this.rules.getSettings()) ?? DEFAULT_SHIPPING_SETTINGS;
	}

	private async priceTestCart(ruleSet: ShippingRuleSet, cart: ShippingTestCart, settings: ShippingSettings) {
		const { snapshot } = await this.snapshots.build(
			cart.lines,
			cart.delivery,
			cart.shopper,
			settings.defaultCharges,
		);
		const zone = shippingZoneFor(snapshot.delivery.country, settings.homeCountry);
		const outcome = evaluateShippingRuleSet({ body: ruleSet.draft, snapshot, zone });
		return { status: outcome.status, amountINR: outcome.status === 'priced' ? outcome.amountINR : null };
	}

	private async assertMethod(zone: 'domestic' | 'international', method: ShippingZoneMethod): Promise<void> {
		if (method.kind === 'courier') {
			throw new BadRequestException({
				issues: [{ path: zone, message: 'No courier is connected', code: 'courier_not_connected' }],
			});
		}
		if (method.ruleSetId === null) return;
		const ruleSet = await this.rules.findRuleSet(method.ruleSetId);
		if (!ruleSet || ruleSet.activeVersion === null) {
			throw new BadRequestException({
				issues: [
					{
						path: `${zone}.ruleSetId`,
						message: 'Choose a rule set that is active',
						code: 'rule_set_not_active',
					},
				],
			});
		}
		if (ruleSet.use !== 'both' && ruleSet.use !== zone) {
			throw new BadRequestException({
				issues: [
					{
						path: `${zone}.ruleSetId`,
						message: 'That rule set is made for the other zone',
						code: 'rule_set_wrong_zone',
					},
				],
			});
		}
	}

	private async require(id: string): Promise<ShippingRuleSet> {
		const ruleSet = await this.rules.findRuleSet(id);
		if (!ruleSet) throw new NotFoundException('Rule set not found');
		return ruleSet;
	}

	private async requireOwn(id: string): Promise<ShippingRuleSet> {
		const ruleSet = await this.require(id);
		if (ruleSet.kind === 'premade')
			throw new ForbiddenException({
				code: 'premade_locked',
				message: 'Pre-made rule sets can’t be changed; make a copy',
			});
		return ruleSet;
	}

	/** The second save over newer work: who changed it and when, nothing overwritten. */
	private clash(current: ShippingRuleSet): ConflictException {
		return new ConflictException({
			code: 'stale_revision',
			revision: current.revision,
			updatedBy: current.updatedBy,
			updatedAt: current.updatedAt ?? null,
		});
	}

	private async record(
		actorUserId: string | null,
		action: string,
		entityId: string | null,
		metadata: Record<string, unknown>,
	): Promise<void> {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'shipping',
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

export function usageOf(
	id: string,
	settings: ShippingSettings,
	exceptions: readonly ShippingException[],
): ShippingRuleSetUsage {
	const zones: ShippingRuleSetUsage['zones'] = [];
	for (const zone of ['domestic', 'international'] as const) {
		const method = settings[zone];
		if (method.kind === 'ruleSet' && method.ruleSetId === id) zones.push({ zone, as: 'siteWide' });
		if (method.kind === 'courier' && method.fallbackRuleSetId === id) zones.push({ zone, as: 'fallback' });
	}
	const exceptionIds = exceptions
		.filter((e) =>
			[e.domestic, e.international].some((choice) => choice.kind === 'ruleSet' && choice.ruleSetId === id),
		)
		.map((e) => e.id);
	return { zones, exceptionIds };
}

export function overviewChecks(
	settings: ShippingSettings,
	ruleSets: readonly ShippingRuleSet[],
	exceptions: readonly ShippingException[],
): ShippingOverviewCheck[] {
	const checks: ShippingOverviewCheck[] = [];
	const byId = new Map(ruleSets.map((r) => [r.id, r]));
	const zoneCheck = (zone: 'domestic' | 'international', method: ShippingZoneMethod): void => {
		if (zone === 'international' && settings.abroadPolicy === 'indiaOnly') return;
		const id = method.kind === 'ruleSet' ? method.ruleSetId : method.fallbackRuleSetId;
		if (method.kind === 'courier')
			checks.push({ code: 'courier_not_connected', severity: 'error', params: { zone } });
		if (id === null) {
			if (method.kind === 'ruleSet') checks.push({ code: 'zone_not_set', severity: 'error', params: { zone } });
			return;
		}
		const ruleSet = byId.get(id);
		if (!ruleSet) checks.push({ code: 'rule_set_missing', severity: 'error', params: { zone } });
		else if (ruleSet.activeVersion === null)
			checks.push({ code: 'rule_set_not_active', severity: 'error', params: { zone, name: ruleSet.name } });
	};
	zoneCheck('domestic', settings.domestic);
	zoneCheck('international', settings.international);
	const { domestic, internationalFirst, internationalFurther } = settings.defaultCharges;
	if (domestic === 0 && internationalFirst === 0 && internationalFurther === 0)
		checks.push({ code: 'default_charges_zero', severity: 'warning', params: {} });
	for (const exception of exceptions) {
		for (const choice of [exception.domestic, exception.international]) {
			if (choice.kind !== 'ruleSet') continue;
			const ruleSet = byId.get(choice.ruleSetId);
			if (!ruleSet || ruleSet.activeVersion === null)
				checks.push({
					code: 'exception_rule_set_missing',
					severity: 'error',
					params: { exceptionId: exception.id },
				});
		}
	}
	return checks;
}
