import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Promotion } from '@saha/contracts';
import type { PromotionRepository } from '@saha/core-domain';

import { PROMOTION_REPOSITORY } from '../infra/tokens';

@Injectable()
export class PromotionsService {
	constructor(@Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepository) {}

	listActive(): Promise<Promotion[]> {
		return this.promotions.listActive();
	}

	async validateCoupon(code: string): Promise<Promotion> {
		const promo = await this.promotions.findByCouponCode(code.trim().toUpperCase());
		if (!promo) throw new NotFoundException(`No active promotion for coupon: ${code}`);

		const now = Date.now();
		const startsOk = !promo.startsAt || Date.parse(promo.startsAt) <= now;
		const endsOk = !promo.endsAt || Date.parse(promo.endsAt) >= now;
		if (!startsOk || !endsOk) throw new NotFoundException(`Coupon is not currently active: ${code}`);

		return promo;
	}
}
