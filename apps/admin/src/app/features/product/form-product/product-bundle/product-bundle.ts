import { Component, input, model } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import type { BundleGroup, ProductBundleWrite } from '@saha-textile/contracts';
import { Select2, type Select2Data } from 'ng-select2-component';

import { FormFields } from '@shared/ui/form-fields/form-fields';

const TYPES = ['fixed_kit', 'choose_one_per_group', 'optional_addons'] as const;
const POLICIES = ['sum_components', 'fixed_bundle_price', 'discounted_components'] as const;

/** A compound product: one purchase made of several items. The price policy is stored here. */
@Component({
	selector: 'app-product-bundle',
	templateUrl: './product-bundle.html',
	imports: [TranslocoModule, Select2, FormFields],
})
export class ProductBundleForm {
	readonly value = model.required<ProductBundleWrite>();
	readonly products = input.required<Select2Data>();
	readonly locale = input.required<string>();

	readonly typeOptions = TYPES.map((value) => ({ value, label: value }));
	readonly policyOptions = POLICIES.map((value) => ({ value, label: value }));

	set(change: Partial<ProductBundleWrite>): void {
		this.value.update((current) => ({ ...current, ...change }));
	}

	private setGroup(index: number, change: Partial<BundleGroup>): void {
		this.set({
			groups: this.value().groups.map((group, position) => (position === index ? { ...group, ...change } : group)),
		});
	}

	addGroup(): void {
		const code = `group-${this.value().groups.length + 1}`;
		this.set({
			groups: [
				...this.value().groups,
				{ code, label: { en: '' }, minSelections: 0, maxSelections: 1, components: [] } as BundleGroup,
			],
		});
	}

	removeGroup(index: number): void {
		this.set({ groups: this.value().groups.filter((_, position) => position !== index) });
	}

	setName(index: number, group: BundleGroup, text: string): void {
		this.setGroup(index, { label: { ...group.label, [this.locale()]: text } });
	}

	setLimit(index: number, field: 'minSelections' | 'maxSelections', text: string): void {
		this.setGroup(index, { [field]: Math.max(0, Math.round(Number(text))) });
	}

	addComponent(index: number, group: BundleGroup, productId: unknown): void {
		if (typeof productId !== 'string' || !productId) return;
		this.setGroup(index, {
			components: [
				...group.components,
				{ productId, variantId: null, quantity: 1, required: true, priceAdjustmentINR: null },
			],
		});
	}

	removeComponent(index: number, group: BundleGroup, component: number): void {
		this.setGroup(index, { components: group.components.filter((_, position) => position !== component) });
	}

	setComponent(index: number, group: BundleGroup, component: number, change: Record<string, unknown>): void {
		this.setGroup(index, {
			components: group.components.map((row, position) => (position === component ? { ...row, ...change } : row)),
		});
	}

	productName(id: string): string {
		const option = this.products().find((row) => 'value' in row && row.value === id);
		return option?.label ?? id;
	}
}
