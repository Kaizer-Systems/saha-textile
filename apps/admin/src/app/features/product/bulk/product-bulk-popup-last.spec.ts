import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { ProductBulkPopup } from './product-bulk-popup';

describe('ProductBulkPopup: the last cases', () => {
	it('shows no counts and plain words before it is asked anything', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(ProductBulkPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(ProductBulkPopup).componentInstance;
		expect(popup.pills()).toEqual([]);
		expect(popup.word('bulk_title_')).toBe('bulk_title_');
		expect(popup.rows()).toEqual([]);
	});
});
