import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { quoteBundle } from '@saha-textile/core-domain/bundle';
import { firstValueFrom } from 'rxjs';

import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { BundleRuleRows } from './bundle-rule-rows';

import type { BundleMethodInput, BundlePriceMethodWrite } from '@saha-textile/contracts';

const blank = (): BundlePriceMethodWrite => ({
	code: '',
	name: { en: '' },
	help: { en: '' },
	inputs: [],
	base: { kind: 'pieces' },
	rules: [],
	combine: 'all',
	active: true,
	sortOrder: 100,
});

/**
 * The price method builder (owner, 22 Nov 2026: "build the builder"; brief C05): a method's name and help line,
 * the numbers each bundle types, where the price starts, and If / Then rules on the shipping builder's blocks.
 * "Try it" prices sample pieces with core's own engine, the one checkout uses.
 */
@Component({
	selector: 'app-price-method-builder',
	templateUrl: './price-method-builder.html',
	imports: [BundleRuleRows, FormsModule, PageWrapper, RouterModule, TranslocoModule],
})
export class PriceMethodBuilder {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly bundles = inject(BundleService);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly id = this.route.snapshot.paramMap.get('id') ?? 'new';
	readonly method = signal<BundlePriceMethodWrite>(blank());
	readonly lang = signal<'en' | 'bn'>('en');
	/** Try it: three sample pieces, priced with this method as it stands. */
	readonly sample = signal<number[]>([16400, 3400, 450]);
	readonly tryParams = signal<Record<string, number>>({});

	readonly tried = computed(() => {
		const m = this.method();
		const items = this.sample().map((price, at) => ({
			key: `p${at + 1}`,
			quantity: 1,
			priceInSetINR: price,
			todayINR: price,
			onSale: false,
		}));
		return quoteBundle({
			levels: items.map((item, at) => ({ code: `l${at + 1}`, take: 1, priceMode: 'difference', items: [item] })),
			extras: [],
			method: { base: m.base, inputs: m.inputs, rules: m.rules, combine: m.combine },
			params: {
				...Object.fromEntries(m.inputs.flatMap((i) => (i.default === null ? [] : [[i.code, i.default]]))),
				...this.tryParams(),
			},
			rules: [],
			combine: 'all',
			capAtSeparately: false,
			roundTo: 'one',
		});
	});

	constructor() {
		if (isPlatformBrowser(inject(PLATFORM_ID)) && this.id !== 'new') void this.load();
	}

	private async load(): Promise<void> {
		const row = await firstValueFrom(this.bundles.method(this.id));
		const { id: _id, seeded: _s, version: _v, usedBy: _u, createdAt: _c, updatedAt: _up, ...write } = row;
		this.method.set(write);
	}

	set(patch: Partial<BundlePriceMethodWrite>): void {
		this.method.update((m) => ({ ...m, ...patch }));
	}

	setText(key: 'name' | 'help', text: string): void {
		this.method.update((m) => ({ ...m, [key]: { ...m[key], [this.lang()]: text } }));
	}

	addInput(): void {
		const input: BundleMethodInput = {
			code: `n${this.method().inputs.length + 1}`,
			label: { en: '' },
			kind: 'percent',
			min: null,
			max: null,
			default: null,
		};
		this.set({ inputs: [...this.method().inputs, input] });
	}

	setInput(at: number, patch: Partial<BundleMethodInput>): void {
		this.set({ inputs: this.method().inputs.map((row, i) => (i === at ? { ...row, ...patch } : row)) });
	}

	setInputLabel(at: number, text: string): void {
		const input = this.method().inputs[at];
		if (input) this.setInput(at, { label: { ...input.label, [this.lang()]: text } as BundleMethodInput['label'] });
	}

	setTryParam(code: string, value: string): void {
		this.tryParams.update((now) => ({ ...now, [code]: Number(value) || 0 }));
	}

	setSample(at: number, value: string): void {
		this.sample.update((now) => now.map((price, i) => (i === at ? Number(value) || 0 : price)));
	}

	removeInput(at: number): void {
		this.set({ inputs: this.method().inputs.filter((_, i) => i !== at) });
	}

	setBase(kind: 'fixed' | 'pieces'): void {
		this.set({
			base:
				kind === 'fixed'
					? { kind: 'fixed', input: this.method().inputs[0]?.code ?? 'setPrice' }
					: { kind: 'pieces' },
		});
	}

	async save(): Promise<void> {
		const body = this.method();
		try {
			if (this.id === 'new') await firstValueFrom(this.bundles.createMethod(body));
			else await firstValueFrom(this.bundles.updateMethod(this.id, body));
			this.notifier.showSuccess(this.transloco.translate('bundle_method_saved'));
			void this.router.navigate(['/product/bundle-price-methods']);
		} catch {
			this.notifier.showError(this.transloco.translate('bundle_method_not_saved'));
		}
	}
}
