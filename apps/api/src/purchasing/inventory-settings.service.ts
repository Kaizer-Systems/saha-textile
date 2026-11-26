import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
	InventorySettings,
	type InventorySettingsView,
	type InventorySettingsWrite,
	type PurchaseStep,
	gstinProblem,
} from '@saha-textile/contracts';
import type { InventorySettingsRepository } from '@saha-textile/core-domain';

import { INVENTORY_SETTINGS_REPOSITORY } from '../infra/tokens';
import { PurchasingSupport, STEP_PERMISSION, refuse } from './purchasing-support';

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

const STEP_NAMES: Record<PurchaseStep, string> = {
	draft: 'make and edit the draft',
	check: 'check goods',
	post: 'post to stock',
	payment: 'record payment',
};
const STEPS: readonly PurchaseStep[] = ['draft', 'check', 'post', 'payment'];

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

	/** x02 as one reader sees it: role names for the steps, and whether they may change the steps (P1). */
	async view(canChangeSteps: boolean): Promise<InventorySettingsView> {
		const settings = await this.settings.get();
		const ids = STEPS.map((step) => settings.stepRules[`${step}RoleId`]);
		return { ...settings, stepRoleLabels: await this.support.roleLabels(ids), canChangeSteps };
	}

	/**
	 * Save x02. Who may do each purchase-entry step (P1) and the books-closed date (P9, "set by
	 * the owner") are the super admin's alone: anyone else with `setting.edit` may change the
	 * other figures, and a change to those two from them is refused and audited as an attempt.
	 */
	async update(
		body: InventorySettingsWrite,
		actor: string | null,
		options: { superAdmin?: boolean } = {},
	): Promise<InventorySettings> {
		const before = await this.settings.get();
		const stepsChanged =
			JSON.stringify(InventorySettings.shape.stepRules.parse(body.stepRules)) !==
			JSON.stringify(before.stepRules);
		const booksChanged = (body.booksClosedUpTo ?? null) !== (before.booksClosedUpTo ?? null);
		if ((stepsChanged || booksChanged) && !options.superAdmin) {
			const what = stepsChanged ? 'who may do the purchase entry steps' : 'the books-closed date';
			await this.support.record({
				actor,
				action: 'purchase.settings.refused',
				entityType: 'inventory_settings',
				entityId: 'inventory',
				text: `${await this.support.nameOf(actor)} tried to change ${what}; only the super admin can.`,
			});
			throw new ForbiddenException({
				message: 'super_admin_only',
				issues: [
					{
						path: ['super_admin_only', stepsChanged ? 'stepRules' : 'booksClosedUpTo'],
						message: `Only the super admin can change ${what}.`,
						code: 'super_admin_only',
					},
				],
			});
		}
		for (const step of STEPS) {
			const roleId = body.stepRules[`${step}RoleId`];
			if (!roleId || roleId === before.stepRules[`${step}RoleId`]) continue;
			const role = await this.support.findRole(roleId);
			if (!role) throw refuse('role_missing', 'That role no longer exists.', `stepRules.${step}RoleId`);
			if (!role.permissions.includes(STEP_PERMISSION[step])) {
				throw refuse(
					'role_lacks_permission',
					`${role.label} does not hold the permission to ${STEP_NAMES[step]}, so nobody could do this step.`,
					`stepRules.${step}RoleId`,
				);
			}
		}
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
			const from = (before.stepRules as Record<string, unknown>)[key];
			const to = (next.stepRules as Record<string, unknown>)[key];
			if (from !== to) changes.push(`"${label}" ${to ? 'on' : 'off'}`);
		}
		const labels = await this.support.roleLabels(
			STEPS.flatMap((step) => [before.stepRules[`${step}RoleId`], next.stepRules[`${step}RoleId`]]),
		);
		const who = (id: string | null) =>
			id ? `the role ${labels[id] ?? 'that no longer exists'}` : 'anyone with the permission';
		for (const step of STEPS) {
			const from = before.stepRules[`${step}RoleId`];
			const to = next.stepRules[`${step}RoleId`];
			if (from !== to) changes.push(`who may ${STEP_NAMES[step]} from ${who(from)} to ${who(to)}`);
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
