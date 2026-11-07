import { CurrencyPipe } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';

import { describe, expect, it, vi } from 'vitest';

import { SettingStore } from '@core/state/setting.store';
import { adminBreadcrumb } from '@shared/util/admin-breadcrumb';
import { CustomValidators } from '@shared/validators/password-match';
import { priceValidator } from '@shared/validators/price-validator';

import { CurrencySymbolPipe } from './currency-symbol.pipe';
import { SummaryPipe } from './summary.pipe';

describe('CurrencySymbolPipe', () => {
	const pipe = (setting: unknown) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				CurrencyPipe,
				CurrencySymbolPipe,
				{ provide: SettingStore, useValue: { setting: signal(setting) } },
			],
		});
		return TestBed.inject(CurrencySymbolPipe);
	};
	const currency = (default_currency: unknown) => ({ general: { default_currency } });

	it('uses rupees before the amount by default', () => {
		expect(pipe(null).transform(10)).toBe('₹10.00');
	});

	it('shows zero for no value', () => {
		expect(pipe(null).transform(undefined as never)).toBe('₹0');
	});

	it('applies the rate, symbol and position from the settings', () => {
		expect(pipe(currency({ exchange_rate: 2, symbol: '€', symbol_position: 'after_price' })).transform(10)).toBe(
			'20.00€',
		);
	});

	it('honours the position it is given', () => {
		expect(pipe(currency({})).transform(10, 'after_price')).toBe('10.00₹');
	});

	it('copes with a formatter that returns nothing', () => {
		const instance = pipe(null);
		(instance as unknown as { currencyPipe: { transform: () => null } }).currencyPipe = { transform: () => null };
		expect(instance.transform(10)).toBe('₹null');
	});
});

describe('SummaryPipe', () => {
	const pipe = () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				SummaryPipe,
				{
					provide: DomSanitizer,
					useValue: { bypassSecurityTrustHtml: vi.fn((value: string) => `safe:${value}`) },
				},
			],
		});
		return TestBed.inject(SummaryPipe);
	};

	it('handles nothing, short text, long text and markup', () => {
		expect(pipe().transform('', 5)).toBe('');
		expect(pipe().transform('hello', 5)).toBe('hello');
		expect(pipe().transform('hello world', 5)).toBe('hello...');
		expect(pipe().transform('<b>x</b>', 20)).toBe('safe:<b>x</b>');
	});
});

describe('validators', () => {
	it('matches two controls', () => {
		const validate = CustomValidators.MatchValidator('a', 'b');
		const group = (a: string, b: string) => new FormGroup({ a: new FormControl(a), b: new FormControl(b) });
		expect(validate(group('x', 'x'))).toBeNull();
		expect(validate(group('x', 'y'))).toEqual({ mismatch: true });
		expect(validate(new FormGroup({ a: new FormControl('x') }))).toBeNull();
		expect(validate(new FormGroup({ b: new FormControl('x') }))).toBeNull();
	});

	it.each([
		[null, null],
		[undefined, null],
		['', null],
		['10', null],
		['10.25', null],
		['10.255', { invalidPrice: true }],
		['abc', { invalidPrice: true }],
	])('reads the price %j', (value, expected) => {
		expect(priceValidator(new FormControl(value))).toEqual(expected);
	});
});

describe('adminBreadcrumb', () => {
	it('wraps each label', () => {
		expect(adminBreadcrumb(['a', 'b'])).toEqual([{ label: 'a' }, { label: 'b' }]);
	});
});
