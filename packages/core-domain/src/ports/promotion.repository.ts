import type { Promotion } from '@saha/contracts';

export interface PromotionRepository {
	findById(id: string): Promise<Promotion | null>;
	findByCouponCode(code: string): Promise<Promotion | null>;
	/** Active = within [startsAt, endsAt] window at `at` (defaults to now). */
	listActive(at?: string): Promise<Promotion[]>;
	save(promotion: Promotion): Promise<Promotion>;
}
