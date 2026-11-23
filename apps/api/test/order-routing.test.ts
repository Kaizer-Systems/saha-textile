import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { OrderRoutingService } from '../src/routing/order-routing.service';

describe('order routing settings (accounts brief M2)', () => {
	it('reads the recommended defaults and saves only over the copy read', async () => {
		const store = new Map<string, unknown>();
		const service = new OrderRoutingService({
			get: async (key: string) => store.get(key) ?? null,
			set: async (key: string, value: unknown) => void store.set(key, value),
		} as never);
		const first = await service.get();
		expect(first).toMatchObject({ mode: 'auto', split: 'never', updatedAt: null });
		const saved = await service.save(
			{ mode: 'suggest', split: 'never', splitLimitINR: 0, nearestBy: 'pin_distance', expectedUpdatedAt: null },
			'adm_owner',
		);
		expect(saved).toMatchObject({ mode: 'suggest', updatedBy: 'adm_owner' });
		await expect(
			service.save(
				{
					mode: 'manual',
					split: 'never',
					splitLimitINR: 0,
					nearestBy: 'pin_distance',
					expectedUpdatedAt: null,
				},
				null,
			),
		).rejects.toBeInstanceOf(ConflictException);
	});
});
