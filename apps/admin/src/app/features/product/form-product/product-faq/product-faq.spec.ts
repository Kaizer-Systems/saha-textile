import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { FaqValue, ProductFaq } from './product-faq';

const render = (value: FaqValue, locale = 'en') => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(ProductFaq, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductFaq);
	fixture.componentRef.setInput('value', value);
	fixture.componentRef.setInput('locale', locale);
	return fixture.componentInstance;
};

describe('ProductFaq', () => {
	it('switches the FAQ on and adds questions up to the limit', () => {
		const faq = render({ enabled: false, rows: [] });
		faq.setEnabled(true);
		faq.add();
		expect(faq.value()).toEqual({ enabled: true, rows: [{ question: {}, answer: {} }] });
		faq.value.set({ enabled: true, rows: Array.from({ length: 30 }, () => ({ question: {}, answer: {} })) });
		faq.add();
		expect(faq.value().rows).toHaveLength(30);
	});

	it('writes the text in the language shown, keeping the others', () => {
		const faq = render({ enabled: true, rows: [{ question: { en: 'Silk?' }, answer: {} }] }, 'bn');
		faq.write(0, 'question', 'সিল্ক?');
		faq.write(0, 'answer', 'হ্যাঁ');
		expect(faq.value().rows[0]).toEqual({ question: { en: 'Silk?', bn: 'সিল্ক?' }, answer: { bn: 'হ্যাঁ' } });
	});

	it('moves and removes questions, and ignores a move past either end', () => {
		const a = { id: 'a', question: { en: 'A' }, answer: {} };
		const b = { id: 'b', question: { en: 'B' }, answer: {} };
		const faq = render({ enabled: true, rows: [a, b] });
		faq.move(1, -1);
		expect(faq.value().rows.map((row) => row.id)).toEqual(['b', 'a']);
		const before = faq.value();
		faq.move(0, -1);
		faq.move(1, 1);
		expect(faq.value()).toBe(before);
		faq.remove(0);
		expect(faq.value().rows.map((row) => row.id)).toEqual(['a']);
	});
});
