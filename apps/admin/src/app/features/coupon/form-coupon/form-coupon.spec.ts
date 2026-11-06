import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { NgbDate, NgbDateParserFormatter } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingStore } from '@core/state/setting.store';
import { CouponService } from '@data-access/services/coupon.service';

import { FormCoupon } from './form-coupon';

const products = signal<unknown>(undefined);
vi.mock('@data-access/queries/product.queries', () => ({
	injectProductsQuery: (p: () => unknown) => (p(), { data: products }),
}));

const saved = {
	id: 1,
	title: 'T',
	description: 'D',
	code: 'C',
	type: 'fixed',
	amount: 5,
	start_date: '2026-11-01',
	end_date: '2026-11-30',
	is_expired: 1,
	is_apply_all: 0,
	products: [{ id: 1 }],
	exclude_products: [{ id: 2 }],
	min_spend: 10,
	usage_per_coupon: 3,
	usage_per_customer: 1,
};

const render = (params: Record<string, unknown> = {}, rows: unknown[] = []) => {
	const router = { navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(params) } },
			{ provide: CouponService, useValue: { getCoupons: () => of({ data: rows }) } },
			{ provide: SettingStore, useValue: { setting: signal(null) } },
		],
	});
	TestBed.overrideComponent(FormCoupon, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FormCoupon);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, router };
};
const day = (value: number) => new NgbDate(2026, 11, value);

afterEach(() => {
	products.set(undefined);
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
	document.body.innerHTML = '';
});

describe('FormCoupon reading', () => {
	it('fills from a saved coupon, reading its dates', () => {
		const { page } = render({ id: 1 }, [saved]);
		expect(page.form.value).toMatchObject({ title: 'T', products: [1], exclude_products: [2] });
		expect(page.fromDate?.month).toBe(11);
		expect(page.toDate?.day).toBe(30);
		expect(page.id).toBe(1);
	});

	it('copes with a coupon with no dates or lists, and a missing one', () => {
		const { page } = render({ id: 1 }, [{ id: 1 }]);
		expect(page.fromDate).toBeNull();
		expect(page.toDate).toBeNull();
		expect(render({ id: 9 }, [{ id: 1 }]).page.data).toBeNull();
	});

	it('lists the products with a fallback image', async () => {
		const { page } = render();
		expect(await firstValueFrom(page.product$)).toEqual([]);
		products.set({
			data: [
				{ id: 1, name: 'A', product_thumbnail: { original_url: 'i.png' } },
				{ id: 2, name: 'B' },
			],
		});
		TestBed.tick();
		expect(await firstValueFrom(page.product$)).toMatchObject([
			{ data: { image: 'i.png' } },
			{ data: { image: 'assets/images/product.png' } },
		]);
	});
});

describe('FormCoupon dependent fields', () => {
	const controls = (page: FormCoupon) => Object.keys(page.form.controls);

	it('drops the dates for a coupon that never expires, and restores them', () => {
		const { page } = render({ id: 1 }, [saved]);
		page.form.controls['is_expired']?.setValue(0);
		expect(controls(page)).not.toContain('start_date');
		page.form.controls['is_expired']?.setValue(1);
		expect(page.form.value.start_date).toBe('2026-11-01');
		const fresh = render().page;
		fresh.form.controls['is_expired']?.setValue(1);
		expect(fresh.form.value.start_date).toBe('');
	});

	it('swaps the product lists with apply-to-all', () => {
		const { page } = render({ id: 1 }, [saved]);
		page.form.controls['is_apply_all']?.setValue(1);
		expect(page.form.value.exclude_products).toEqual([2]);
		expect(controls(page)).not.toContain('products');
		page.form.controls['is_apply_all']?.setValue(0);
		expect(page.form.value.products).toEqual([1]);
		expect(controls(page)).not.toContain('exclude_products');
		const fresh = render().page;
		fresh.form.controls['is_apply_all']?.setValue(1);
		expect(fresh.form.value.exclude_products).toBeNull();
		fresh.form.controls['is_apply_all']?.setValue(0);
		expect(fresh.form.value.products).toBeNull();
	});

	it('drops the usage limits for unlimited coupons, and restores them', () => {
		const { page } = render({ id: 1 }, [saved]);
		page.form.controls['is_unlimited']?.setValue(1);
		expect(controls(page)).not.toContain('usage_per_coupon');
		page.form.controls['is_unlimited']?.setValue(0);
		expect(page.form.value.usage_per_coupon).toBe(3);
	});

	it('drops the amount for free shipping', () => {
		const { page } = render({ id: 1 }, [saved]);
		page.form.controls['type']?.setValue('free_shipping');
		expect(controls(page)).not.toContain('amount');
		page.form.controls['type']?.setValue('fixed');
		expect(page.form.value.amount).toBe(5);
	});
});

describe('FormCoupon product search', () => {
	it('searches after a pause, and resets a closed search', () => {
		vi.useFakeTimers();
		const { page } = render();
		page.searchProduct({ search: 'silk' } as never);
		vi.advanceTimersByTime(300);
		expect(document.body.classList.contains('loader-none')).toBe(true);
		document.body.classList.remove('loader-none');
		page.productDropdown({ innerSearchText: 'x' } as never);
		vi.advanceTimersByTime(300);
		expect(document.body.classList.contains('loader-none')).toBe(true);
		document.body.classList.remove('loader-none');
		page.productDropdown({ innerSearchText: '' } as never);
		vi.advanceTimersByTime(300);
		expect(document.body.classList.contains('loader-none')).toBe(false);
	});
});

describe('FormCoupon dates', () => {
	it('builds a range from two picks, and restarts on an earlier one', () => {
		const { page } = render();
		page.onDateSelection(day(5));
		expect(page.form.value.start_date).toBe('2026-11-5');
		page.onDateSelection(day(9));
		expect(page.form.value.end_date).toBe('2026-11-9');
		page.onDateSelection(day(7));
		expect(page.toDate).toBeNull();
		page.onDateSelection(day(2));
		expect(page.fromDate?.day).toBe(2);
	});

	it('marks hovered, inside and range days', () => {
		const { page } = render();
		page.fromDate = day(5);
		page.hoveredDate = day(9);
		expect(page.isHovered(day(7))).toBe(true);
		page.toDate = day(9);
		expect(page.isHovered(day(7))).toBeFalsy();
		expect(page.isInside(day(7))).toBe(true);
		expect(page.isRange(day(5))).toBe(true);
		expect(page.isRange(day(9))).toBe(true);
		expect(page.isRange(day(7))).toBe(true);
		expect(page.isRange(day(20))).toBeFalsy();
		page.toDate = null;
		expect(page.isRange(day(7))).toBeTruthy();
	});

	it('skips writing a date it does not have', () => {
		const { page } = render();
		page.onDateSelection(null as never);
		expect(page.fromDate).toBeNull();
	});

	it('validates typed dates', () => {
		const { page } = render();
		const formatter = TestBed.inject(NgbDateParserFormatter);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce({ year: 2026, month: 11, day: 5 });
		expect(page.validateInput(null, 'ok')?.day).toBe(5);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce(null);
		expect(page.validateInput(day(1), 'no')?.day).toBe(1);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce({ year: 2026, month: 13, day: 5 });
		expect(page.validateInput(day(1), 'bad')?.day).toBe(1);
	});
});

describe('FormCoupon.submit', () => {
	it('goes to the list from a valid form', () => {
		const { page, router } = render({ id: 1 }, [saved]);
		page.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/coupon');
		expect(page.tabError).toBeNull();
	});

	it('opens the tab holding the first invalid field', () => {
		const { page } = render();
		document.body.innerHTML = '<div class="tab" tab="restriction"><input id="title" /></div>';
		const select = vi.fn();
		Object.defineProperty(page, 'nav', { value: () => ({ select }) });
		page.submit();
		expect(select).toHaveBeenCalledWith('restriction');
		expect(page.tabError).toBe('restriction');
	});

	it('stays quiet when the invalid field is not on a tab', () => {
		const { page } = render();
		page.submit();
		expect(page.tabError).toBeUndefined();
	});

	it('cleans up when destroyed', () => {
		const { fixture } = render();
		expect(() => fixture.destroy()).not.toThrow();
	});
});
