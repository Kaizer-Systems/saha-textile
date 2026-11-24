import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

/**
 * Nest reads each class's constructor types from decorator metadata, which the compiler writes as
 * `typeof X === "undefined" ? Object : X`. Every other test loads the real services, so this one loads
 * the two background rounds with their service missing, as a module cycle would leave it, to show the
 * metadata falls back to Object instead of failing.
 */
vi.mock('../src/shop-checkout/shop-payments.service', async (load) => ({
	...(await load<object>()),
	ShopPaymentsService: undefined,
}));
vi.mock('../src/mailboxes/inbox.service', async (load) => ({ ...(await load<object>()), InboxService: undefined }));

describe('background rounds without the service they are given', () => {
	it('still declares each round, with Object for the missing type', async () => {
		const types = (target: object) => Reflect.getMetadata('design:paramtypes', target) as unknown[];
		const { ShopPaymentSweep } = await import('../src/shop-checkout/shop-payment-sweep.js');
		const { UndoSendDispatcher } = await import('../src/mailboxes/undo-send.dispatcher.js');
		expect(types(ShopPaymentSweep)).toEqual([Object]);
		expect(types(UndoSendDispatcher)).toEqual([Object]);
	});
});
