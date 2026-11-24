import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseItemsController } from '../src/purchasing/purchase-entries.controller';
import { PurchaseReturnsController } from '../src/purchasing/purchase-returns.controller';
import { PurchasingPrintsController } from '../src/purchasing/purchasing-prints.controller';
import { StockController } from '../src/purchasing/stock.controller';
import { SuppliersController } from '../src/purchasing/suppliers.controller';

describe('purchases and stock controllers, edges', () => {
	it('sends holds to the holds route and write-offs to the adjustments route', () => {
		const stock = { adjust: vi.fn(() => 'done') };
		const controller = new StockController(stock as never, {} as never);
		expect(() => controller.adjust({ action: 'hold' } as never, undefined)).toThrow('wrong_route');
		expect(() => controller.hold({ action: 'remove' } as never, undefined)).toThrow('wrong_route');
		expect(() => controller.hold({ action: 'add' } as never, undefined)).toThrow('wrong_route');
		expect(controller.hold({ action: 'release' } as never, undefined)).toBe('done');
		expect(controller.adjust({ action: 'add' } as never, undefined)).toBe('done');
	});

	it('answers not found for stock prints on a server without them', async () => {
		const controller = new PurchasingPrintsController({} as never, null);
		await expect(controller.countSheet('sc_1', undefined, {} as never)).rejects.toBeInstanceOf(NotFoundException);
		await expect(controller.openingStock('os_1', undefined, {} as never)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('passes no supplier when none is asked for', () => {
		const items = { byVariants: vi.fn(), variantGrid: vi.fn() };
		const controller = new PurchaseItemsController(items as never);
		controller.byVariants({ ids: ['v1'] } as never);
		controller.variants('p1', {} as never);
		expect(items.byVariants).toHaveBeenCalledWith(['v1'], null);
		expect(items.variantGrid).toHaveBeenCalledWith('p1', null);
		const returns = { returnable: vi.fn() };
		new PurchaseReturnsController(returns as never).returnable({ entryId: 'pe_1', kind: 'damaged' } as never);
		expect(returns.returnable).toHaveBeenCalledWith('pe_1', 'damaged', null, null);
		const suppliers = { checkGstin: vi.fn() };
		new SuppliersController(suppliers as never).checkGstin({ gstin: '19AAPFS4821K1ZM' } as never);
		expect(suppliers.checkGstin).toHaveBeenCalledWith('19AAPFS4821K1ZM', null);
	});
});
