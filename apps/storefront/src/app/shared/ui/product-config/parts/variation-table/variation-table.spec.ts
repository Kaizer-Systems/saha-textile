import { CurrencyPipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

import { LOW_STOCK_AT, VariationTable } from './variation-table';

const variation = (id: number, quantity: number, stock_status = 'in_stock') =>
	({
		id,
		name: `Size ${id}`,
		sku: `SKU-${id}`,
		quantity,
		stock_status,
		sale_price: 1000 + id,
	}) as unknown as IVariation;

const render = (variations: IVariation[], selected: IVariation | null = null) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [VariationTable, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [CurrencyPipe],
	});
	const fixture = TestBed.createComponent(VariationTable);
	fixture.componentRef.setInput('product', { variations } as unknown as IProduct);
	fixture.componentRef.setInput('selected', selected);
	fixture.detectChanges();
	return { host: fixture.nativeElement as HTMLElement, table: fixture.componentInstance };
};

describe('VariationTable', () => {
	it('reads "Only N left" at or under the shop default of 2', () => {
		expect(LOW_STOCK_AT).toBe(2);
		expect(render([]).table.lowStock).toBe(2);
	});

	it('draws nothing for a product without variations', () => {
		expect(render([]).host.querySelector('table')).toBeNull();
	});

	it('draws every variation and marks the chosen one', () => {
		const rows = [variation(32, 5), variation(34, 2), variation(36, 0, 'out_of_stock')];
		const trs = render(rows, rows[1]).host.querySelectorAll('tbody tr');
		expect(trs).toHaveLength(3);
		expect(trs[1].classList.contains('active')).toBe(true);
		expect(trs[1].querySelector('.st-radio')?.classList.contains('is-on')).toBe(true);
		expect(trs[1].querySelector('.st-low-stock')).not.toBeNull();
		expect(trs[2].classList.contains('disabled')).toBe(true);
		expect(trs[0].querySelector('.in-stock')).not.toBeNull();
		expect(trs[0].classList.contains('active')).toBe(false);
	});
});
