import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, Select2Data, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { Subject, debounceTime, firstValueFrom, switchMap } from 'rxjs';

import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { ZONE_TIERS, newZoneGroup, newZoneId, newZoneRule, ruleWords } from '@core/zones/zone-blocks';
import { ZONES_KEY, ZonesGateway } from '@core/zones/zones.gateway';
import { ICategory } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';

import { ZoneConditions } from './zone-conditions';
import { ZoneFormula } from './zone-formula';

import type { PriceZone, ZoneRule, ZoneRuleScope, ZoneTryResult } from '@saha-textile/contracts';

function flatten(rows: readonly ICategory[] = [], depth = 0): Array<{ id: string; label: string }> {
	return rows.flatMap((row) => [
		{ id: String(row.id), label: `${'— '.repeat(depth)}${row.name}` },
		...flatten((row as { subcategories?: ICategory[] }).subcategories ?? [], depth + 1),
	]);
}

/**
 * The rules the server flagged (refusal `zone_rule_problems`, params `{ problems: [{ ruleId, problem }] }`),
 * read from the error body as the API sends it (directly or wrapped once).
 */
export function zoneProblemsOf(error: unknown): Map<string, string[]> {
	const map = new Map<string, string[]>();
	const outer = (error as { error?: unknown } | null)?.error;
	const wrapped = outer && typeof outer === 'object' ? (outer as { error?: unknown }).error : undefined;
	const body = (wrapped && typeof wrapped === 'object' ? wrapped : outer) as { issues?: unknown } | undefined;
	const issues = Array.isArray(body?.issues) ? body.issues : [];
	for (const issue of issues as Array<{ params?: { problems?: unknown } }>) {
		const rows = Array.isArray(issue?.params?.problems) ? issue.params.problems : [];
		for (const row of rows as Array<{ ruleId?: unknown; problem?: unknown }>) {
			if (typeof row.ruleId !== 'string' || typeof row.problem !== 'string') continue;
			map.set(row.ruleId, [...(map.get(row.ruleId) ?? []), row.problem]);
		}
	}
	return map;
}

/** "2026-11-20T10:30" from an ISO time, as a datetime-local box shows it (India time). */
export function isoToLocalInput(iso: string | null): string {
	if (!iso) return '';
	return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

/** The ISO time for a datetime-local value typed in India time. */
export function localInputToIso(value: string): string | null {
	if (!value) return null;
	const at = new Date(`${value}:00.000+05:30`);
	return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Customers › Zones › a zone (DEC-B2B-ZONES; owner, 2026-11-20): the zone's price list as rules in
 * three fixed tiers (product exceptions, then category rules, then all products). Within a tier the
 * first enabled rule that matches wins, in the order staff drag them into. Each rule has its scope,
 * optional conditions, a price formula, and extras (rounding, floor and ceiling, minimum quantity,
 * dates). "In plain words" reads the rules back; Try it prices them on real products, unsaved.
 * Built from the shipping rule builder's blocks (`srb-*`, the approved custom piece).
 */
@Component({
	selector: 'app-zone-editor',
	templateUrl: './zone-editor.html',
	// The shipping rule builder's block layout, shared as it is (no new styles).
	styleUrls: ['../shipping/builder/rule-builder.scss'],
	imports: [CdkDrag, CdkDragHandle, CdkDropList, RouterModule, Select2, TranslocoModule, ZoneConditions, ZoneFormula],
})
export class ZoneEditor {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(ZonesGateway);
	private readonly products = inject(ProductService);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly destroyRef = inject(DestroyRef);
	private readonly auth = inject(AuthStore);

	readonly id = signal<string | null>(this.route.snapshot.paramMap.get('id'));
	readonly zone = signal<PriceZone | null>(null);
	readonly name = signal('');
	readonly code = signal('');
	readonly description = signal('');
	readonly rules = signal<ZoneRule[]>([]);
	readonly tiers = ZONE_TIERS;
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);
	/** Rules the server's checks flagged, with what is wrong. */
	readonly problems = signal<Map<string, string[]>>(new Map());

	readonly readOnly = computed(() => {
		const zone = this.zone();
		const permission = this.id() ? 'price_zone.edit' : 'price_zone.create';
		return !!zone?.system || !this.auth.permissions().includes(permission);
	});
	readonly mayReadCost = computed(() => this.auth.permissions().includes('stock.cost'));

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product' }));
	readonly categories = computed(() => flatten(this.categoriesQuery.data()?.data ?? []));
	readonly categoryOptions = computed<Select2Data>(() =>
		this.categories().map((row) => ({ value: row.id, label: row.label })),
	);
	private readonly categoryNames = computed(
		() => new Map(this.categories().map((row) => [row.id, row.label.replace(/^(— )+/, '')])),
	);

	/** Product names seen so far, so the pickers can show the chosen ones. */
	readonly productNames = signal<Map<string, string>>(new Map());
	readonly productOptions = signal<Select2Data>([]);
	private readonly productSearch = new Subject<string>();

	readonly byTier = computed(() => {
		const rules = this.rules();
		return Object.fromEntries(
			this.tiers.map((tier) => [tier, rules.filter((rule) => rule.scope.tier === tier)]),
		) as Record<ZoneRuleScope['tier'], ZoneRule[]>;
	});
	readonly words = computed(() => {
		const t = (key: string, params?: Record<string, string | number>) => this.transloco.translate(key, params);
		const nameOf = (id: string) => this.categoryNames().get(id) ?? this.productNames().get(id) ?? id;
		return this.tiers.flatMap((tier) =>
			this.byTier()[tier].map((rule) => ({ id: rule.id, text: ruleWords(rule, t, nameOf) })),
		);
	});

	readonly tryItems = signal<Array<{ productId: string; label: string; quantity: number }>>([]);
	readonly tryResult = signal<ZoneTryResult | null>(null);
	readonly trying = signal(false);

	constructor() {
		this.productSearch
			.pipe(
				debounceTime(250),
				switchMap((search) => this.products.getCatalogProducts({ search, pageSize: 15 })),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((list) => {
				const names = new Map(this.productNames());
				for (const row of list.items) names.set(row.id, `${row.title} · ${row.sku}`);
				this.productNames.set(names);
				this.productOptions.set(
					this.withChosen(list.items.map((row) => ({ value: row.id, label: `${row.title} · ${row.sku}` }))),
				);
			});
		this.productSearch.next('');
		const id = this.id();
		if (id) void this.load(id);
	}

	/** Chosen products stay in the list, or select2 forgets their names. */
	private withChosen(rows: Select2Data): Select2Data {
		const seen = new Set(rows.map((row) => String((row as { value: unknown }).value)));
		const chosen = this.rules().flatMap((rule) => (rule.scope.tier === 'product' ? rule.scope.productIds : []));
		const extra = [...new Set(chosen)]
			.filter((id) => !seen.has(id))
			.map((id) => ({ value: id, label: this.productNames().get(id) ?? id }));
		return [...extra, ...rows];
	}

	private async load(id: string): Promise<void> {
		try {
			const zone = await firstValueFrom(this.gateway.get(id));
			this.zone.set(zone);
			this.name.set(zone.name);
			this.code.set(zone.code);
			this.description.set(zone.description);
			this.rules.set(zone.rules);
			this.productOptions.update((rows) => this.withChosen(rows));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	/* ------------------------------------------------------------------ rules */

	private setRule(id: string, change: Partial<ZoneRule>): void {
		this.rules.update((rules) =>
			rules.map((rule) => (rule.id === id ? ({ ...rule, ...change } as ZoneRule) : rule)),
		);
	}

	update(rule: ZoneRule, change: Partial<ZoneRule>): void {
		this.setRule(rule.id, change);
	}

	addRule(tier: ZoneRuleScope['tier']): void {
		this.rules.update((rules) => [...rules, newZoneRule(tier)]);
	}

	duplicate(rule: ZoneRule): void {
		const copy: ZoneRule = {
			...structuredClone(rule),
			id: newZoneId('r'),
			name: rule.name ? `${rule.name} (2)` : '',
		};
		this.rules.update((rules) => {
			const at = rules.findIndex((row) => row.id === rule.id);
			const next = [...rules];
			next.splice(at + 1, 0, copy);
			return next;
		});
	}

	remove(rule: ZoneRule): void {
		this.rules.update((rules) => rules.filter((row) => row.id !== rule.id));
	}

	/** Dragging reorders within a tier; tiers themselves never move (owner: tiers stay fixed). */
	drop(tier: ZoneRuleScope['tier'], event: CdkDragDrop<ZoneRule[]>): void {
		const inTier = [...this.byTier()[tier]];
		moveItemInArray(inTier, event.previousIndex, event.currentIndex);
		this.rules.set(this.tiers.flatMap((each) => (each === tier ? inTier : this.byTier()[each])));
	}

	addConditions(rule: ZoneRule): void {
		this.setRule(rule.id, { when: newZoneGroup() });
	}

	setProducts(rule: ZoneRule, event: Select2UpdateEvent): void {
		const ids = (Array.isArray(event.value) ? event.value : []).map(String);
		this.setRule(rule.id, { scope: { tier: 'product', productIds: ids as [string, ...string[]] } });
	}

	setCategories(rule: ZoneRule, event: Select2UpdateEvent): void {
		const ids = (Array.isArray(event.value) ? event.value : []).map(String);
		const subs = rule.scope.tier === 'category' ? rule.scope.includeSubcategories : true;
		this.setRule(rule.id, {
			scope: { tier: 'category', categoryIds: ids as [string, ...string[]], includeSubcategories: subs },
		});
	}

	setSubcategories(rule: ZoneRule, include: boolean): void {
		if (rule.scope.tier !== 'category') return;
		this.setRule(rule.id, { scope: { ...rule.scope, includeSubcategories: include } });
	}

	searchProducts(event: Select2SearchEvent): void {
		this.productSearch.next(event.search);
	}

	amount(value: string): number | null {
		const text = String(value).replace(/[₹,\s]/g, '');
		if (!text) return null;
		const parsed = Number(text);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
	}

	productIdsOf(rule: ZoneRule): string[] {
		return rule.scope.tier === 'product' ? rule.scope.productIds : [];
	}

	categoryIdsOf(rule: ZoneRule): string[] {
		return rule.scope.tier === 'category' ? rule.scope.categoryIds : [];
	}

	problemsOf(rule: ZoneRule): string[] {
		return this.problems().get(rule.id) ?? [];
	}

	readonly toLocal = isoToLocalInput;
	readonly fromLocal = localInputToIso;

	/* ------------------------------------------------------------------ Try it */

	addTryItem(event: Select2UpdateEvent): void {
		const id = event.value === null || event.value === undefined ? '' : String(event.value);
		if (!id || this.tryItems().some((row) => row.productId === id) || this.tryItems().length >= 20) return;
		this.tryItems.update((rows) => [
			...rows,
			{ productId: id, label: this.productNames().get(id) ?? id, quantity: 1 },
		]);
	}

	setTryQuantity(productId: string, quantity: number): void {
		this.tryItems.update((rows) =>
			rows.map((row) => (row.productId === productId ? { ...row, quantity: Math.max(1, quantity || 1) } : row)),
		);
	}

	removeTryItem(productId: string): void {
		this.tryItems.update((rows) => rows.filter((row) => row.productId !== productId));
	}

	async tryIt(): Promise<void> {
		if (!this.tryItems().length) return;
		this.trying.set(true);
		try {
			this.tryResult.set(
				await firstValueFrom(
					this.gateway.tryRules({
						rules: this.rules(),
						items: this.tryItems().map((row) => ({
							productId: row.productId,
							variantId: null,
							quantity: row.quantity,
						})),
					}),
				),
			);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.trying.set(false);
		}
	}

	/** One step of how a price was reached, in words: "Tier: Category rules", "Rule: Silk −15%". */
	traceWords(code: string): string {
		const t = (key: string, params?: Record<string, string>) => this.transloco.translate(key, params);
		const [head = '', rest = ''] = code.split(':');
		const detail =
			head === 'tier'
				? t(`zone_tier_${rest}`)
				: head === 'rule'
					? this.rules().find((rule) => rule.id === rest)?.name || t('zone_unnamed_rule')
					: head === 'formula'
						? t(`zone_kind_${rest}`)
						: head === 'rounding'
							? t(`zone_rounding_${rest}`)
							: head === 'retail'
								? t(`zone_retail_${rest}`)
								: rest;
		const key = `zone_trace_${head}`;
		const words = t(key, { detail });
		return words === key ? code : words;
	}

	/* ------------------------------------------------------------------ save and status */

	canSave(): boolean {
		return !this.saving() && !this.readOnly() && !!this.name().trim() && /^[A-Z][A-Z0-9-]{1,23}$/.test(this.code());
	}

	async save(): Promise<PriceZone | null> {
		if (!this.canSave()) return null;
		this.saving.set(true);
		this.error.set(null);
		this.problems.set(new Map());
		try {
			const saved = await firstValueFrom(
				this.gateway.save(this.id(), {
					code: this.code(),
					name: this.name().trim(),
					description: this.description().trim(),
					rules: this.rules(),
					...(this.zone() ? { revision: this.zone()?.revision } : {}),
				}),
			);
			this.zone.set(saved);
			this.rules.set(saved.rules);
			void this.queryClient.invalidateQueries({ queryKey: [...ZONES_KEY] });
			this.notifier.showSuccess(this.transloco.translate('zone_saved'));
			if (!this.id()) {
				this.id.set(saved.id);
				void this.router.navigate(['/zones', saved.id], { replaceUrl: true });
			}
			return saved;
		} catch (error) {
			this.readProblems(error);
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
			return null;
		} finally {
			this.saving.set(false);
		}
	}

	/** A live zone saves only without mistakes; the server names each rule and what is wrong. */
	private readProblems(error: unknown): void {
		this.problems.set(zoneProblemsOf(error));
	}

	async setStatus(status: 'draft' | 'live' | 'archived'): Promise<void> {
		const saved = this.readOnly() ? this.zone() : await this.save();
		const zone = saved ?? this.zone();
		if (!zone || (!saved && !this.readOnly())) return;
		this.saving.set(true);
		try {
			const next = await firstValueFrom(this.gateway.setStatus(zone.id, { status, revision: zone.revision }));
			this.zone.set(next);
			void this.queryClient.invalidateQueries({ queryKey: [...ZONES_KEY] });
			this.notifier.showSuccess(this.transloco.translate(`zone_status_saved_${status}`));
		} catch (error) {
			this.readProblems(error);
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.saving.set(false);
		}
	}
}
