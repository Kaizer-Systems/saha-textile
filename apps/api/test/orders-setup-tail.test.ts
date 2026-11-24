import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderSettings } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { OrderSettingsService } from '../src/orders-setup/order-settings.service';
import { AdminBusinessesController, AdminCouponsController } from '../src/orders-setup/orders-setup.controller';

describe('orders setup: the last cases', () => {
	it('reads the order settings and saves them with who and when', async () => {
		const stored = OrderSettings.parse({});
		const save = vi.fn(async (next: OrderSettings) => next);
		const audit = { append: vi.fn(async () => undefined) };
		const svc = new OrderSettingsService({ get: async () => stored, save } as never, {} as never, audit as never);
		expect(await svc.getSettings()).toBe(stored);
		const saved = await svc.saveSettings({ ...stored, revision: 3 } as never, 'adm_1');
		expect(saved).toMatchObject({ updatedBy: 'adm_1' });
		expect(save).toHaveBeenCalledWith(expect.objectContaining({ updatedBy: 'adm_1' }), 3);
		expect(audit.append).toHaveBeenCalledOnce();
	});

	it('sends a bulk delete of coupons to its own route', () => {
		const controller = new AdminCouponsController({ bulk: vi.fn() } as never);
		expect(() => controller.bulkSwitch({ action: 'delete', ids: ['cpn_1'] } as never)).toThrow(BadRequestException);
	});

	it('has no documents to print without the document service, and owes nothing on a side the business is not on', async () => {
		const businesses = {
			get: async (id: string) => ({ id, roles: { customer: null, supplier: false } }),
			receivableINR: vi.fn(),
			payableINR: vi.fn(),
		};
		const controller = new AdminBusinessesController(businesses as never, null);
		await expect(controller.documentPdf('biz_1', 'rcpt_1', {} as never)).rejects.toBeInstanceOf(NotFoundException);
		expect(await controller.balances('biz_1')).toEqual({ theyOweUsINR: 0, weOweThemINR: 0 });
		expect(businesses.receivableINR).not.toHaveBeenCalled();
		expect(businesses.payableINR).not.toHaveBeenCalled();
	});
});
