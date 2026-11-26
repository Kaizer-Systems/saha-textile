import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
	Component,
	DestroyRef,
	TemplateRef,
	computed,
	effect,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdownModule, NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ruleSetReadsWeight, validateShippingRuleSet, type ShippingIssue } from '@saha-textile/core-domain/shipping';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Subject, catchError, debounceTime, firstValueFrom, forkJoin, map, of, switchMap } from 'rxjs';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { duplicateStep, newAdjust, newStep } from '@core/shipping/blocks';
import { plainWords, type ChargeAmount, type ChargeAmounts } from '@core/shipping/plain-words';
import {
	injectShippingOverviewQuery,
	SHIPPING_KEY,
	SHIPPING_STALE_MS,
	ShippingGateway,
	shippingProblemText,
} from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { UnsavedChanges } from '@core/unsaved/unsaved-changes';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPhone } from '@features/media/file-manager/fm-phone';
import { askConfirm } from '@features/purchasing/shared/popups';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import { SrbNode } from './srb-node';
import { SrbTry } from './srb-try';

import type {
	ShippingAdjust,
	ShippingChargeKind,
	ShippingRuleSetBody,
	ShippingRuleSetUse,
	ShippingStep,
	ShippingTestCart,
	ShippingTestCartChange,
} from '@saha-textile/contracts';

/** How many earlier versions of the blocks Undo can go back through. */
const HISTORY = 50;

/**
 * Admin › Shipping › Rule sets › Edit (brief rb02–rb11): the rule builder. Blocks read like a
 * sentence — for each line, if this, then charge that, otherwise free; combine; adjust. The right
 * column proves the rule set on real products (Try it), keeps saved test carts that must still
 * match before a new version goes live, and writes the rule set out in plain words. Pre-made rule
 * sets open read only with "Make a copy"; on a phone every rule set opens read only.
 */
@Component({
	selector: 'app-rule-builder',
	templateUrl: './rule-builder.html',
	styleUrls: ['./rule-builder.scss'],
	imports: [
		FormFields,
		FormsModule,
		RouterLink,
		TranslocoModule,
		NgbDropdownModule,
		CdkDropList,
		CdkDrag,
		CdkDragHandle,
		SrbNode,
		SrbTry,
	],
})
export class RuleBuilder {
	/** The rule set id, from the route. */
	private readonly route = inject(ActivatedRoute);
	readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
		initialValue: this.route.snapshot.paramMap.get('id') ?? '',
	});

	private readonly gateway = inject(ShippingGateway);
	private readonly categoriesService = inject(CategoryService);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);
	private readonly languagesService = inject(ActiveLanguages);
	readonly phone = inject(FmPhone);

	private readonly overview = injectShippingOverviewQuery();
	readonly query = injectQuery(() => ({
		queryKey: [...SHIPPING_KEY, 'rule-set', this.id()],
		queryFn: () => firstValueFrom(this.gateway.ruleSet(this.id())),
		staleTime: SHIPPING_STALE_MS,
	}));
	readonly categoryRows = injectQuery(() => ({
		queryKey: ['shipping', 'category-rows'],
		queryFn: () => firstValueFrom(this.categoriesService.getCategoryRows()),
		staleTime: SHIPPING_STALE_MS,
	}));

	readonly name = signal('');
	readonly description = signal('');
	readonly use = signal<ShippingRuleSetUse>('domestic');
	readonly body = signal<ShippingRuleSetBody>({ steps: [], adjust: [] });
	readonly testCarts = signal<ShippingTestCart[]>([]);
	readonly revision = signal(0);
	readonly dirty = signal(false);
	readonly busy = signal(false);
	private readonly past = signal<ShippingRuleSetBody[]>([]);
	private readonly future = signal<ShippingRuleSetBody[]>([]);
	readonly changes = signal<ShippingTestCartChange[]>([]);
	private readonly changesPopup = viewChild<TemplateRef<unknown>>('changesPopup');
	private readonly versionsPopup = viewChild<TemplateRef<unknown>>('versionsPopup');
	private openPopup: NgbModalRef | null = null;
	/** The revision the editor last loaded, so a refetch never overwrites unsaved edits. */
	private loaded = -1;

	readonly uses: ShippingRuleSetUse[] = ['domestic', 'international', 'both'];
	readonly adjustKinds: ShippingAdjust['kind'][] = ['minimum', 'maximum', 'roundUp', 'freeAbove'];
	readonly scopes: ShippingStep['scope'][] = ['eachLine', 'wholeCart', 'eachUnit'];

	readonly detail = computed(() => this.query.data() ?? null);
	readonly premade = computed(() => this.detail()?.ruleSet.kind === 'premade');
	readonly canEdit = computed(() => this.auth.permissions().includes('shipping.edit'));
	readonly canCreate = computed(() => this.auth.permissions().includes('shipping.create'));
	readonly readOnly = computed(() => this.premade() || !this.canEdit() || this.phone.is());
	readonly shopLanguages = computed(() => this.languagesService.shopLocales());
	readonly allLanguages = computed(() => this.languagesService.list());
	readonly categories = computed(() =>
		(this.categoryRows.data() ?? []).map((row) => ({ id: row.id, label: row.path ?? row.name['en'] ?? row.id })),
	);
	/**
	 * "₹100 on every category" beside a product charge (brief rb02, rb03): each category's value,
	 * through its parents and then the shop default, gathered into one amount or a range.
	 */
	readonly chargeAmounts = computed<ChargeAmounts>(() => {
		const rows = this.categoryRows.data() ?? [];
		const overview = this.overview.data();
		const shop = (overview?.settings ?? overview?.defaults)?.defaultCharges;
		if (rows.length === 0 || !shop) return {};
		const byId = new Map(rows.map((row) => [row.id, row]));
		const keys = {
			domestic: 'domesticINR',
			internationalFirst: 'internationalFirstINR',
			internationalFurther: 'internationalFurtherINR',
		} as const;
		const amounts: ChargeAmounts = {};
		for (const kind of ['domestic', 'internationalFirst', 'internationalFurther'] as const) {
			const resolve = (id: string): number => {
				const seen = new Set<string>();
				let row = byId.get(id);
				while (row && !seen.has(row.id)) {
					seen.add(row.id);
					const value = row.shipping?.[keys[kind]];
					if (value !== null && value !== undefined) return value;
					row = row.parentId ? byId.get(row.parentId) : undefined;
				}
				return shop[kind];
			};
			const values = [...new Set(rows.map((row) => resolve(row.id)))].sort((a, b) => a - b);
			// One value per category row, and there is at least one row here.
			const low = values[0] as number;
			const high = values[values.length - 1] as number;
			amounts[kind] =
				low === high
					? { amount: this.rupees(low), every: true }
					: { amount: `${this.rupees(low)}–${this.rupees(high)}`, every: false };
		}
		return amounts;
	});
	readonly chargeHints = computed<Partial<Record<ShippingChargeKind, string>>>(() => {
		const hints: Partial<Record<ShippingChargeKind, string>> = {};
		for (const [kind, known] of Object.entries(this.chargeAmounts()) as Array<[ShippingChargeKind, ChargeAmount]>)
			hints[kind] = this.transloco.translate(known.every ? 'ship_hint_every_category' : 'ship_hint_by_category', {
				amount: known.amount,
			});
		return hints;
	});
	/** A step that reads weight says how chargeable weight is worked out (brief rb10). */
	stepReadsWeight(step: ShippingStep): boolean {
		return ruleSetReadsWeight({ steps: [step], adjust: [] });
	}
	/** The other two ways a loop's results can combine, for the hint beside the select (brief rb02). */
	otherCombines(step: ShippingStep): string {
		const all = ['sum', 'highest', 'lowest'] as const;
		const list = all
			.filter((choice) => choice !== step.combine)
			.map((choice) => this.transloco.translate(`ship_combine_${choice}_${step.scope}`).toLocaleLowerCase())
			.join(', ');
		return this.transloco.translate('ship_other_choices', { list });
	}
	readonly check = computed(() =>
		validateShippingRuleSet(this.body(), this.use(), { languages: this.shopLanguages() }),
	);
	readonly errors = computed(() => this.check().issues.filter((issue) => issue.severity === 'error'));
	readonly warnings = computed(() => this.check().issues.filter((issue) => issue.severity === 'warning'));
	readonly errorIds = computed(() => new Set(this.errors().map((issue) => issue.blockId)));
	readonly words = computed(() => {
		const names = new Map(this.categories().map((c) => [c.id, c.label] as const));
		return plainWords(
			this.body(),
			(key, params) => this.transloco.translate(key, params),
			(id) => names.get(id) ?? id,
			this.chargeAmounts(),
		);
	});
	/** "used site-wide", "used by 2 exception(s)" or "not used yet", after the active version (brief rb02). */
	readonly usageWords = computed(() => {
		const usage = this.detail()?.usage;
		if (usage?.zones.some((z) => z.as === 'siteWide'))
			return this.transloco.translate('ship_status_used_site_wide');
		if (usage?.exceptionIds.length)
			return this.transloco.translate('ship_status_used_exceptions', { count: usage.exceptionIds.length });
		return this.transloco.translate('ship_status_not_used');
	});
	/** "the shop's home country (India)" in the Used-for help. */
	readonly homeCountryName = computed(() => {
		const data = this.overview.data();
		const code = (data?.settings ?? data?.defaults)?.homeCountry ?? 'IN';
		return this.transloco.translate(`ship_country_${code}`);
	});
	/** Whether any block gives a result yet; until one does, Try it asks for a charge (brief rb05). */
	readonly hasResult = computed(() => JSON.stringify(this.body()).includes('"kind":"result"'));
	readonly canUndo = computed(() => this.past().length > 0);
	readonly canRedo = computed(() => this.future().length > 0);

	/** What each saved test cart costs with the blocks as they stand (null: it doesn't price). */
	readonly testCartNow = signal<Record<string, number | null>>({});
	private readonly recheck = new Subject<{ body: ShippingRuleSetBody; carts: ShippingTestCart[] }>();

	constructor() {
		// Reload or close with unsaved blocks: the browser asks first (the builder is not a form).
		inject(DestroyRef).onDestroy(inject(UnsavedChanges).register(() => this.dirty()));
		const sub = this.recheck
			.pipe(
				debounceTime(500),
				switchMap(({ body, carts }) =>
					carts.length === 0
						? of({})
						: forkJoin(
								carts.map((cart) =>
									this.gateway
										.tryIt({
											body,
											lines: cart.lines,
											delivery: cart.delivery,
											shopper: cart.shopper,
										})
										.pipe(
											map(
												(result) =>
													[
														cart.id,
														result.status === 'priced' ? result.amountINR : null,
													] as const,
											),
											catchError(() => of([cart.id, null] as const)),
										),
								),
							).pipe(map((pairs) => Object.fromEntries(pairs) as Record<string, number | null>)),
				),
			)
			.subscribe((now) => this.testCartNow.set(now));
		inject(DestroyRef).onDestroy(() => sub.unsubscribe());
		effect(() => this.recheck.next({ body: this.body(), carts: this.testCarts() }));
		effect(() => {
			const detail = this.detail();
			if (!detail || detail.ruleSet.revision === this.loaded) return;
			untracked(() => {
				if (this.dirty()) return;
				this.loaded = detail.ruleSet.revision;
				this.name.set(detail.ruleSet.name);
				this.description.set(detail.ruleSet.description);
				this.use.set(detail.ruleSet.use);
				this.body.set(structuredClone(detail.ruleSet.draft));
				this.testCarts.set(structuredClone(detail.ruleSet.testCarts));
				this.revision.set(detail.ruleSet.revision);
				this.past.set([]);
				this.future.set([]);
			});
		});
	}

	/** Every edit of the blocks goes through here, so Undo can step back through it. */
	edit(next: ShippingRuleSetBody) {
		this.past.update((past) => [...past.slice(-HISTORY + 1), this.body()]);
		this.future.set([]);
		this.body.set(next);
		this.dirty.set(true);
	}

	undo() {
		const past = this.past();
		const previous = past[past.length - 1];
		if (!previous) return;
		this.future.update((future) => [this.body(), ...future]);
		this.past.set(past.slice(0, -1));
		this.body.set(previous);
		this.dirty.set(true);
	}

	redo() {
		const [next, ...rest] = this.future();
		if (!next) return;
		this.past.update((past) => [...past, this.body()]);
		this.future.set(rest);
		this.body.set(next);
		this.dirty.set(true);
	}

	touch() {
		this.dirty.set(true);
	}

	setStep(index: number, change: Partial<ShippingStep>) {
		const steps = this.body().steps.map((step, i) => (i === index ? { ...step, ...change } : step));
		this.edit({ ...this.body(), steps });
	}

	addStep(scope: ShippingStep['scope']) {
		this.edit({ ...this.body(), steps: [...this.body().steps, newStep(scope)] });
	}

	duplicate(index: number) {
		const steps = [...this.body().steps];
		const step = steps[index];
		if (!step) return;
		steps.splice(index + 1, 0, duplicateStep(step));
		this.edit({ ...this.body(), steps });
	}

	removeStep(index: number) {
		this.edit({ ...this.body(), steps: this.body().steps.filter((_, i) => i !== index) });
	}

	drop(event: CdkDragDrop<ShippingStep[]>) {
		if (event.previousIndex === event.currentIndex) return;
		const steps = [...this.body().steps];
		moveItemInArray(steps, event.previousIndex, event.currentIndex);
		this.edit({ ...this.body(), steps });
	}

	addAdjust(kind: ShippingAdjust['kind']) {
		this.edit({ ...this.body(), adjust: [...this.body().adjust, newAdjust(kind)] });
	}

	setAdjustValue(index: number, value: unknown) {
		const n = Number(value);
		const amount = value === '' || value === null || !Number.isFinite(n) ? null : n;
		const adjust = this.body().adjust.map((a, i) => {
			if (i !== index) return a;
			if (a.kind === 'roundUp') return { ...a, to: amount };
			if (a.kind === 'freeAbove') return { ...a, subtotal: amount };
			return { ...a, amount };
		});
		this.edit({ ...this.body(), adjust });
	}

	adjustValue(adjust: ShippingAdjust): number | null {
		return adjust.kind === 'roundUp' ? adjust.to : adjust.kind === 'freeAbove' ? adjust.subtotal : adjust.amount;
	}

	removeAdjust(index: number) {
		this.edit({ ...this.body(), adjust: this.body().adjust.filter((_, i) => i !== index) });
	}

	/** The number shown on each box: steps and their Combine boxes counted in order, then Adjust. */
	stepNumber(index: number): number {
		return this.body()
			.steps.slice(0, index)
			.reduce((n, step) => n + (step.scope === 'wholeCart' ? 1 : 2), 1);
	}

	adjustNumber(): number {
		return this.stepNumber(this.body().steps.length);
	}

	issueText(issue: ShippingIssue): string {
		const params: Record<string, string | number> = { ...(issue.params ?? {}) };
		if (typeof params['field'] === 'string')
			params['field'] = this.transloco.translate(`ship_f_${String(params['field']).replace(/\./g, '_')}`);
		if (typeof params['language'] === 'string')
			// With the default fallback ('code'), of() answers a name or the code itself, never undefined.
			params['language'] = new Intl.DisplayNames([String(params['language'])], { type: 'language' }).of(
				String(params['language']),
			) as string;
		const where = issue.stepId
			? this.transloco.translate('ship_issue_in_step', {
					number: this.stepNumber(this.body().steps.findIndex((s) => s.id === issue.stepId)),
				})
			: '';
		return `${where}${this.transloco.translate(`ship_issue_${issue.code}`, params)}`;
	}

	addTestCart(cart: ShippingTestCart) {
		this.testCarts.update((carts) => [...carts, cart]);
		this.dirty.set(true);
		this.notifier.showSuccess(this.transloco.translate('ship_test_cart_added'));
	}

	removeTestCart(id: string) {
		this.testCarts.update((carts) => carts.filter((cart) => cart.id !== id));
		this.dirty.set(true);
	}

	/** Saves the working copy; resolves true when it was saved. */
	async save(quiet = false): Promise<boolean> {
		if (this.busy() || this.readOnly()) return false;
		this.busy.set(true);
		try {
			const saved = await firstValueFrom(
				this.gateway.save(this.id(), {
					name: this.name().trim(),
					description: this.description().trim(),
					use: this.use(),
					draft: this.body(),
					testCarts: this.testCarts(),
					revision: this.revision(),
				}),
			);
			this.dirty.set(false);
			this.loaded = saved.ruleSet.revision;
			this.revision.set(saved.ruleSet.revision);
			this.queryClient.setQueryData([...SHIPPING_KEY, 'rule-set', this.id()], saved);
			void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
			if (!quiet) {
				const key = saved.ruleSet.activeVersion === null ? 'ship_draft_saved_inactive' : 'ship_draft_saved';
				this.notifier.showSuccess(this.transloco.translate(key));
			}
			return true;
		} catch (error) {
			this.notifier.showError(shippingProblemText(error, this.transloco));
			return false;
		} finally {
			this.busy.set(false);
		}
	}

	/** Saves, then makes the saved copy the new active version (rb11). */
	async activate(accept: ShippingTestCartChange[] = []) {
		if (!this.check().canActivate) return;
		if (this.dirty() && !(await this.save(true))) return;
		this.busy.set(true);
		try {
			const result = await firstValueFrom(
				this.gateway.activate(this.id(), {
					revision: this.revision(),
					acceptChanges: accept
						.filter((c) => c.toINR !== null)
						.map((c) => ({ testCartId: c.testCartId, toINR: c.toINR as number })),
				}),
			);
			if (result.outcome === 'activated') {
				this.openPopup?.close();
				this.accepted.set(null);
				this.loaded = -1;
				this.dirty.set(false);
				this.queryClient.setQueryData([...SHIPPING_KEY, 'rule-set', this.id()], result.detail);
				void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
				this.notifier.showSuccess(this.transloco.translate('ship_activated', { version: result.version }));
			} else if (result.outcome === 'testCartsChanged') {
				this.changes.set(result.changes);
				const popup = this.changesPopup();
				if (popup)
					this.openPopup = this.modals.open(popup, {
						centered: true,
						size: 'lg',
						windowClass: 'theme-modal',
						ariaLabelledBy: 'ship_changes_title',
					});
			} else {
				this.notifier.showError(this.transloco.translate('ship_fix_first'));
			}
		} catch (error) {
			this.notifier.showError(shippingProblemText(error, this.transloco));
		} finally {
			this.busy.set(false);
		}
	}

	/** Saved test carts whose amount now differs from the one accepted (brief rb08). */
	readonly changedCarts = computed(() => {
		const now = this.testCartNow();
		return this.testCarts().filter((cart) => {
			const amount = now[cart.id];
			return amount !== undefined && amount !== cart.expectedINR;
		});
	});
	readonly changesAllPriced = computed(() =>
		this.changedCarts().every((cart) => typeof this.testCartNow()[cart.id] === 'number'),
	);
	/** New amounts accepted with "Accept new amounts", sent when the version is made active. */
	readonly accepted = signal<ShippingTestCartChange[] | null>(null);

	/** An accepted list is for the blocks it was accepted against; any edit asks again. */
	private readonly forgetAccepted = effect(() => {
		this.body();
		this.testCarts();
		untracked(() => this.accepted.set(null));
	});

	acceptNewAmounts() {
		const now = this.testCartNow();
		this.accepted.set(
			this.changedCarts().map((cart) => ({
				testCartId: cart.id,
				name: cart.name,
				fromINR: cart.expectedINR,
				toINR: now[cart.id] ?? null,
				status: 'priced' as const,
			})),
		);
	}

	/** "Make version N active?" (brief rb11): the theme's confirmation, naming how the test carts stand. */
	async confirmActivate() {
		const detail = this.detail();
		if (!detail || !this.check().canActivate) return;
		const changed = this.changedCarts();
		const accepted = this.accepted();
		if (changed.length > 0 && !accepted) {
			// Not accepted yet: the server lists the changes and asks for them (the changes popup).
			await this.activate();
			return;
		}
		const version = Math.max(0, ...detail.versions.map((v) => v.version)) + 1;
		const count = this.testCarts().length;
		const line =
			changed.length === 0
				? this.transloco.translate(count ? 'ship_all_carts_match' : 'ship_no_carts_to_check', { count })
				: this.transloco.translate('ship_carts_accepted', { count: changed.length });
		const yes = await askConfirm(this.modals, {
			icon: 'ri-refresh-line',
			title: 'ship_make_active_title',
			body: 'ship_make_active_body',
			params: { version },
			yes: 'ship_make_active',
			cancel: 'ship_not_yet',
			items: [line],
		});
		if (yes) await this.activate(accepted ?? []);
	}

	/** Whether every changed test cart can be accepted (each still prices). */
	readonly changesAcceptable = computed(() =>
		this.changes().every((change) => change.status === 'priced' && change.toINR !== null),
	);

	showVersions() {
		const popup = this.versionsPopup();
		if (popup)
			this.modals.open(popup, {
				centered: true,
				windowClass: 'theme-modal',
				ariaLabelledBy: 'ship_versions_title',
			});
	}

	/** Pre-made rule sets are copied, then edited (rb09). */
	async makeCopy() {
		const detail = this.detail();
		if (!detail) return;
		try {
			const copy = await firstValueFrom(
				this.gateway.create({
					name: this.transloco.translate('ship_copy_name', { name: detail.ruleSet.name }).slice(0, 80),
					description: detail.ruleSet.description,
					use: detail.ruleSet.use,
					copyFromId: detail.ruleSet.id,
				}),
			);
			void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
			void this.router.navigate(['/shipping/rule-sets', copy.ruleSet.id]);
		} catch (error) {
			this.notifier.showError(shippingProblemText(error, this.transloco));
		}
	}

	rupees(value: number | null): string {
		return value === null ? '—' : `₹${value.toLocaleString('en-IN')}`;
	}
}
