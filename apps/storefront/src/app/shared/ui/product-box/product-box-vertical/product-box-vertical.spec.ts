import { CurrencyPipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { IProduct } from '@data-access/interfaces/product.interface';

import { ProductBoxVertical } from './product-box-vertical';

const product = {
	name: 'Silk',
	slug: 'silk',
	price: 100,
	sale_price: 100,
	product_thumbnail: { original_url: 'https://cdn.example/card.webp' },
} as IProduct;

describe('product card image priority', () => {
	function render(priority: 'high' | 'low' | 'lazy') {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [ProductBoxVertical, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
			providers: [provideRouter([]), CurrencyPipe],
		});
		const fixture = TestBed.createComponent(ProductBoxVertical);
		fixture.componentRef.setInput('product', product);
		fixture.componentRef.setInput('imagePriority', priority);
		fixture.detectChanges();
		return fixture.nativeElement.querySelector('img') as HTMLImageElement;
	}

	it('marks the first card high, the rest of the row low, and later cards lazy', () => {
		expect(render('high').getAttribute('fetchpriority')).toBe('high');
		expect(render('high').getAttribute('loading')).toBe('eager');
		expect(render('low').getAttribute('fetchpriority')).toBe('low');
		expect(render('low').getAttribute('loading')).toBe('eager');
		expect(render('lazy').getAttribute('loading')).toBe('lazy');
		expect(render('lazy').getAttribute('fetchpriority')).toBeNull();
	});
});
