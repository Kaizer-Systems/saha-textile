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

describe('ProductFaq: the last cases', () => {
	it('writes one question and leaves the others as they were', () => {
		const first = { question: { en: 'Silk?' }, answer: {} };
		const faq = render({ enabled: true, rows: [first, { question: { en: 'Wash?' }, answer: {} }] });
		faq.write(1, 'answer', 'Dry clean');
		expect(faq.value().rows[0]).toBe(first);
		expect(faq.value().rows[1]?.answer).toEqual({ en: 'Dry clean' });
	});
});
