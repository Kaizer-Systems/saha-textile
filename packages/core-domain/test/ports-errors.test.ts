import { describe, expect, it } from 'vitest';

import { EDocRefusedError, EDocUnavailableError } from '../src/ports/edocs.port';
import {
	CouponUsedUpError,
	DuplicateCouponCodeError,
	DuplicateOrderKeyError,
	NOT_CONNECTED_EINVOICE,
	NOT_CONNECTED_EWAYBILL,
	StaleRevisionError,
} from '../src/ports/orders-build.port';
import { StaleVersionError, StockMovementRefusedError } from '../src/ports/purchasing.repository';

describe('the errors ports raise', () => {
	it('carry what went wrong, by name', () => {
		const stale = new StaleRevisionError('order', 'o1');
		expect(stale).toMatchObject({
			name: 'StaleRevisionError',
			entity: 'order',
			id: 'o1',
			changedBy: null,
			changedAt: null,
		});
		expect(stale.message).toBe('order o1 was changed by another save');
		expect(new StaleRevisionError('order', 'o1', 'u1', '2026-11-20')).toMatchObject({
			changedBy: 'u1',
			changedAt: '2026-11-20',
		});
		expect(new DuplicateOrderKeyError('idempotencyKey')).toMatchObject({
			name: 'DuplicateOrderKeyError',
			key: 'idempotencyKey',
			message: 'Duplicate order idempotencyKey',
		});
		expect(new CouponUsedUpError('c1')).toMatchObject({
			name: 'CouponUsedUpError',
			message: 'Coupon c1 has no uses left',
		});
		expect(new DuplicateCouponCodeError('TEN')).toMatchObject({
			name: 'DuplicateCouponCodeError',
			message: 'Coupon code TEN is taken',
		});
		const current = { version: 3, updatedAt: '2026-11-20', updatedBy: null };
		expect(new StaleVersionError('entry', 'pe1', current)).toMatchObject({
			name: 'StaleVersionError',
			current,
			message: 'entry pe1 was changed by someone else',
		});
		expect(new StockMovementRefusedError('v1')).toMatchObject({
			name: 'StockMovementRefusedError',
			variantId: 'v1',
			message: 'stock movement refused for v1',
		});
		expect(new EDocRefusedError('2150', 'Duplicate IRN')).toMatchObject({
			name: 'EDocRefusedError',
			code: '2150',
			message: 'Duplicate IRN',
		});
		expect(new EDocUnavailableError('timeout')).toMatchObject({ name: 'EDocUnavailableError', message: 'timeout' });
	});

	it('answer “not connected” while no e-document service is', async () => {
		expect(NOT_CONNECTED_EINVOICE.connected).toBe(false);
		expect(await NOT_CONNECTED_EINVOICE.raise({} as never)).toEqual({ kind: 'notConnected' });
		expect(await NOT_CONNECTED_EWAYBILL.raise({} as never)).toEqual({ kind: 'notConnected' });
	});
});
