import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { describe, expect, it, vi } from 'vitest';

import { SummaryPipe } from './summary.pipe';

describe('SummaryPipe', () => {
	const render = () => {
		const bypass = vi.fn((value: string) => `safe:${value}`);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [SummaryPipe, { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: bypass } }],
		});
		return TestBed.inject(SummaryPipe);
	};

	it('returns nothing for nothing', () => {
		expect(render().transform('', 5)).toBe('');
	});

	it('keeps short text, and cuts long text', () => {
		const pipe = render();
		expect(pipe.transform('hello', 5)).toBe('hello');
		expect(pipe.transform('hello world', 5)).toBe('hello...');
	});

	it('marks text with markup as safe', () => {
		expect(render().transform('<b>x</b>', 20)).toBe('safe:<b>x</b>');
	});
});
