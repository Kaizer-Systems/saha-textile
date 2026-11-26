import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { OrderProgress } from './order-progress';
import { orderStepRank } from './order-steps';
import { ThumbStack } from '../thumb-stack/thumb-stack';

describe('order progress track and picture stack (owner, 22 Nov 2026)', () => {
	it('ranks the steps, Packed with Processing, nothing for a cancelled order', () => {
		expect(
			['placed', 'packed', 'processing', 'delivered', 'cancelled', 'open'].map((s) => orderStepRank(s as never)),
		).toEqual([0, 1, 1, 4, null, null]);
	});

	it('fills the steps reached, and the whole track once cancelled', () => {
		const fixture = TestBed.createComponent(OrderProgress);
		fixture.componentRef.setInput('status', 'shipped');
		fixture.detectChanges();
		const on = () => fixture.nativeElement.querySelectorAll('.st-order-progress-step.is-on').length;
		expect(on()).toBe(3);
		fixture.componentRef.setInput('status', 'cancelled');
		fixture.detectChanges();
		expect(on()).toBe(5);
		expect(fixture.nativeElement.querySelector('.st-order-progress').classList).toContain('is-cancelled');
	});

	it('shows up to three pictures and counts the rest', () => {
		const fixture = TestBed.createComponent(ThumbStack);
		fixture.componentRef.setInput('images', ['a', 'b', 'c', 'd']);
		fixture.componentRef.setInput('more', 2);
		fixture.detectChanges();
		const el: HTMLElement = fixture.nativeElement;
		expect(el.querySelectorAll('img')).toHaveLength(3);
		expect(el.querySelector('.st-thumbs-more')?.textContent?.trim()).toBe('+3');
		fixture.componentRef.setInput('images', []);
		fixture.componentRef.setInput('more', 0);
		fixture.detectChanges();
		expect(el.querySelector('img')?.getAttribute('src')).toBe('assets/images/product.png');
		expect(el.querySelector('.st-thumbs-more')).toBeNull();
	});
});
