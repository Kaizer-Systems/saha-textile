import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	Coupon,
	type CouponBulkAction,
	type CouponBulkResult,
	type CouponListQuery,
	type CouponListResponse,
	type CouponWrite,
} from '@saha-textile/contracts';
import { DuplicateCouponCodeError, type AuditLogRepository, type CouponRepository } from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import { AUDIT_LOG_REPOSITORY, COUPON_REPOSITORY } from '../infra/tokens';
import { auditOrdersChange, refuseStale } from './orders-audit';

/**
 * Admin › Coupons (`DEC-PROMO-STACK`; brief cp01–cp05; owner 2026-11-20: row ticks with bulk Delete,
 * Turn on and Turn off, and a row on/off switch). A coupon already used on an order is never deleted:
 * bulk Delete turns it off instead and says so.
 */
@Injectable()
export class CouponsService {
	constructor(
		@Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	list(query: CouponListQuery): Promise<CouponListResponse> {
		return this.coupons.list(query, new Date());
	}

	async get(id: string): Promise<Coupon> {
		const coupon = await this.coupons.findById(id);
		if (!coupon) throw new NotFoundException('That coupon does not exist');
		return coupon;
	}

	async create(input: CouponWrite, actor: string | null): Promise<Coupon> {
		const now = new Date().toISOString();
		const { revision: _ignored, ...fields } = input;
		void _ignored;
		const coupon = Coupon.parse({
			...fields,
			id: `cpn_${randomUUID()}`,
			usedCount: 0,
			revision: 0,
			createdAt: now,
			updatedAt: now,
			updatedBy: actor,
		});
		const saved = await this.saveCode(() => this.coupons.save(coupon, null), coupon.code);
		await auditOrdersChange(this.audit, actor, 'coupon.create', 'coupon', saved.id, { code: saved.code });
		return saved;
	}

	async update(id: string, input: CouponWrite, actor: string | null): Promise<Coupon> {
		const current = await this.get(id);
		if (input.revision === undefined)
			throw new BadRequestException(
				codedRefusal('revision_required', 'Send the revision you edited', 'revision'),
			);
		const { revision, ...fields } = input;
		const next = Coupon.parse({ ...current, ...fields, updatedAt: new Date().toISOString(), updatedBy: actor });
		const saved = await refuseStale(
			() => this.saveCode(() => this.coupons.save(next, revision), next.code),
			'Someone else saved this coupon first',
		);
		await auditOrdersChange(this.audit, actor, 'coupon.update', 'coupon', id, { code: saved.code });
		return saved;
	}

	async setEnabled(id: string, enabled: boolean, actor: string | null): Promise<Coupon> {
		await this.get(id);
		await this.coupons.setEnabled([id], enabled, actor ?? 'system');
		await auditOrdersChange(this.audit, actor, enabled ? 'coupon.turn_on' : 'coupon.turn_off', 'coupon', id, {});
		return this.get(id);
	}

	/** Bulk actions act on every ticked coupon, on any page (owner, 2026-11-20). */
	async bulk(input: CouponBulkAction, actor: string | null): Promise<CouponBulkResult> {
		const ids = [...new Set(input.ids)];
		const refused: CouponBulkResult['refused'] = [];
		let done: string[];
		if (input.action === 'delete') {
			const deletable: string[] = [];
			for (const id of ids) {
				const coupon = await this.coupons.findById(id);
				if (!coupon) refused.push({ id, code: '', reason: 'not_found' });
				else if (await this.coupons.usedOnOrders(id))
					refused.push({ id, code: coupon.code, reason: 'used_on_orders' });
				else deletable.push(id);
			}
			done = await this.coupons.delete(deletable);
			// A used coupon is kept for the orders that carry it, and turned off instead.
			const used = refused.filter((row) => row.reason === 'used_on_orders').map((row) => row.id);
			if (used.length) await this.coupons.setEnabled(used, false, actor ?? 'system');
		} else {
			done = await this.coupons.setEnabled(ids, input.action === 'turnOn', actor ?? 'system');
			for (const id of ids) if (!done.includes(id)) refused.push({ id, code: '', reason: 'not_found' });
		}
		await auditOrdersChange(this.audit, actor, `coupon.bulk_${input.action}`, 'coupon', null, { done, refused });
		return { done, refused };
	}

	private async saveCode<T>(work: () => Promise<T>, code: string): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof DuplicateCouponCodeError) {
				throw new ConflictException(
					codedRefusal('coupon_code_taken', `The code ${code} is already used by another coupon`, 'code'),
				);
			}
			throw error;
		}
	}
}
