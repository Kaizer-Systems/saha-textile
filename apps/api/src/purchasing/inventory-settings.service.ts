import { Inject, Injectable } from '@nestjs/common';
import { InventorySettings, type InventorySettingsWrite, gstinProblem } from '@saha-textile/contracts';
import type { InventorySettingsRepository } from '@saha-textile/core-domain';

import { INVENTORY_SETTINGS_REPOSITORY } from '../infra/tokens';
import { PurchasingSupport, refuse } from './purchasing-support';

const LABELS: Record<string, string> = {
	priceChangeWarnPct: 'the price-change warning',
	marginFloorPct: 'the margin floor',
	heldReminderDays: 'the held stock reminder',
	booksClosedUpTo: 'books closed up to',
	unpaidAlertDays: 'the unpaid bill alert',
	defaultPaymentTermsDays: 'the default payment terms',
	defaultDeliverTo: 'the default delivery place',
};

const STEP_LABELS: Record<string, string> = {
	checkByDifferentPerson: 'check goods needs a different person',
	postByDifferentPerson: 'post to stock needs a different person',
	paymentByDifferentPerson: 'record payment needs a different person',
};

/**
 * Settings › Purchases and stock (x02). Only `setting.edit` holders change it (the super admin:
 * P1 step rules included). Every change is audited in a sentence, the books-closed date most of all.
 */
@Injectable()
export class InventorySettingsService {
	constructor(
		@Inject(INVENTORY_SETTINGS_REPOSITORY) private readonly settings: InventorySettingsRepository,
		private readonly support: PurchasingSupport,
	) {}

	get(): Promise<InventorySettings> {
		return this.settings.get();
	}

	async update(body: InventorySettingsWrite, actor: string | null): Promise<InventorySettings> {
		const before = await this.settings.get();
		if (body.business.gstin) {
			const problem = gstinProblem(body.business.gstin);
			if (problem) {
				throw refuse(
					'gstin_invalid',
					problem.problem === 'check_digit'
						? `The GSTIN should end in ${problem.expected}.`
						: 'That is not a GSTIN.',
					'business.gstin',
				);
			}
		}
		const next = InventorySettings.parse({
			...before,
			...body,
			business: { ...body.business, gstin: body.business.gstin ? body.business.gstin.toUpperCase() : null },
			numberFormats: before.numberFormats,
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		});
		await this.settings.save(next);

		const name = await this.support.nameOf(actor);
		const changes: string[] = [];
		for (const [key, label] of Object.entries(LABELS)) {
			const from = (before as unknown as Record<string, unknown>)[key];
			const to = (next as unknown as Record<string, unknown>)[key];
			if (from !== to) changes.push(`${label} from ${String(from ?? 'none')} to ${String(to ?? 'none')}`);
		}
		for (const [key, label] of Object.entries(STEP_LABELS)) {
			const from = (before.stepRules as Record<string, boolean>)[key];
			const to = (next.stepRules as Record<string, boolean>)[key];
			if (from !== to) changes.push(`"${label}" ${to ? 'on' : 'off'}`);
		}
		if (JSON.stringify(before.business) !== JSON.stringify(next.business))
			changes.push("the shop's name, GSTIN or address on documents");
		if (changes.length) {
			await this.support.record({
				actor,
				action: 'purchase.settings.update',
				entityType: 'inventory_settings',
				entityId: 'inventory',
				text: `${name} changed ${changes.join('; ')}.`,
			});
		}
		return next;
	}
}
