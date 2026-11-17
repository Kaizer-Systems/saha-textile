import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
	ShopDetails,
	type ShopDetailsImpact,
	type ShopDetailsView,
	type ShopDetailsWrite,
	type Supplier,
	gstStateName,
	gstinProblem,
	homeGstStateOf,
	panFromGstin,
	shopDetailsMissing,
	shopPan,
} from '@saha-textile/contracts';
import { type ShopDetailsRepository, type SupplierRepository, purchaseTaxType } from '@saha-textile/core-domain';

import { SHOP_DETAILS_REPOSITORY, SUPPLIER_REPOSITORY } from '../infra/tokens';
import { PurchaseOrderDocument } from './purchase-order-document';
import { PurchasingSupport, refuse } from './purchasing-support';

/** How each field reads in an audit sentence. */
const FIELD_WORDS: Readonly<Record<keyof Omit<ShopDetails, 'updatedAt' | 'updatedBy'>, string>> = {
	gstin: 'GSTIN',
	legalName: 'legal name',
	tradeName: 'trade name',
	address: 'address',
	city: 'city',
	pin: 'PIN code',
	phone: 'phone on documents',
	email: 'email on documents',
};

const PAGE = 200;

const charge = (count: number) => `${count} ${count === 1 ? 'supplier now charges' : 'suppliers now charge'}`;

/**
 * Settings › Shop details (X04–X04D, purchases brief R3-1; owner round 2026-11-18, S1 A and S2 A).
 * Anyone with Settings access reads it; only `shop_details.edit` changes it, and a refused change
 * is audited. The GSTIN's State is the home State for purchase tax: when it changes, every
 * supplier's tax type is worked out again at once, draft entries take it on their next save, and
 * posted entries never change.
 */
@Injectable()
export class ShopDetailsService {
	constructor(
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly repository: ShopDetailsRepository,
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
		private readonly document: PurchaseOrderDocument,
		private readonly support: PurchasingSupport,
	) {}

	async view(canEdit: boolean): Promise<ShopDetailsView> {
		const [details, brand] = await Promise.all([this.support.shopDetails(), this.document.brandFacts()]);
		const stateCode = details.gstin ? details.gstin.slice(0, 2) : null;
		const home = homeGstStateOf(details);
		return {
			...details,
			stateCode,
			stateName: stateCode ? gstStateName(stateCode) : null,
			pan: shopPan(details),
			homeStateCode: home,
			homeStateName: gstStateName(home) ?? home,
			missing: shopDetailsMissing(details),
			canEdit,
			updatedByName: details.updatedBy ? await this.support.nameOf(details.updatedBy) : null,
			logoUrl: brand.logoUrl,
			brandShopName: brand.shopName,
		};
	}

	/**
	 * X04 / X04B: a typed GSTIN checked here (format, State code, check digit with the right last
	 * character), and when it reads, the State before and after and the suppliers that would move.
	 */
	async impact(gstin: string): Promise<ShopDetailsImpact> {
		const value = gstin.replace(/\s+/g, '').toUpperCase();
		const from = await this.support.homeState();
		const stateFrom = { code: from, name: gstStateName(from) ?? from };
		const problem = gstinProblem(value);
		if (problem) {
			return {
				problem: problem.problem,
				expectedLastCharacter: problem.expected ?? null,
				pan: null,
				stateFrom,
				stateTo: null,
				stateChanges: false,
				toIntraState: [],
				toInterState: [],
			};
		}
		const to = value.slice(0, 2);
		const moves = from === to ? { toIntraState: [], toInterState: [] } : await this.taxMoves(from, to);
		return {
			problem: null,
			expectedLastCharacter: null,
			pan: panFromGstin(value),
			stateFrom,
			stateTo: { code: to, name: gstStateName(to) ?? to },
			stateChanges: from !== to,
			toIntraState: moves.toIntraState.map((supplier) => ({ id: supplier.id, name: supplier.legalName })),
			toInterState: moves.toInterState.map((supplier) => ({ id: supplier.id, name: supplier.legalName })),
		};
	}

	async update(body: ShopDetailsWrite, actor: string | null, options: { canEdit: boolean }): Promise<ShopDetails> {
		const name = await this.support.nameOf(actor);
		if (!options.canEdit) {
			await this.support.record({
				actor,
				action: 'shop_details.refused',
				entityType: 'shop_details',
				entityId: 'shop',
				text: `${name} tried to change the shop details without Edit shop details.`,
			});
			throw new ForbiddenException({
				message: 'shop_details_edit_only',
				issues: [
					{
						path: ['shop_details_edit_only'],
						message: 'Only people with Edit shop details can change these.',
						code: 'shop_details_edit_only',
					},
				],
			});
		}
		const problem = gstinProblem(body.gstin);
		if (problem) throw this.gstinRefusal(problem);

		const before = await this.support.shopDetails();
		const fromState = homeGstStateOf(before);
		const now = new Date().toISOString();
		const next = ShopDetails.parse({
			legalName: body.legalName,
			tradeName: body.tradeName,
			gstin: body.gstin.toUpperCase(),
			address: body.address,
			city: body.city,
			pin: body.pin,
			phone: body.phone,
			email: body.email,
			updatedAt: now,
			updatedBy: actor,
		});
		await this.support.guardStale(() => this.repository.save(next, body.expectedUpdatedAt));

		const toState = homeGstStateOf(next);
		const sentences: string[] = [];
		const changes: Array<{ field: string; from: string; to: string }> = [];
		for (const [field, words] of Object.entries(FIELD_WORDS) as Array<[keyof typeof FIELD_WORDS, string]>) {
			const from = before[field] ?? '';
			const to = next[field] ?? '';
			if (from === to) continue;
			changes.push({ field, from, to });
			sentences.push(`the shop's ${words} from ${from ? `"${from}"` : 'empty'} to ${to ? `"${to}"` : 'empty'}`);
		}
		if (sentences.length) {
			const state =
				fromState === toState
					? `State unchanged (${gstStateName(toState) ?? toState}).`
					: `State ${gstStateName(fromState) ?? fromState} → ${gstStateName(toState) ?? toState}.`;
			await this.support.record({
				actor,
				action: 'shop_details.update',
				entityType: 'shop_details',
				entityId: 'shop',
				text: `${name} changed ${sentences.join('; ')}.${changes.some((change) => change.field === 'gstin') ? ` ${state}` : ''}`,
				facts: { changes },
			});
		}
		if (fromState !== toState) await this.moveSuppliers(fromState, toState, actor, name);
		return next;
	}

	/** Every supplier's tax type against the new home State; only those that change are saved. */
	private async moveSuppliers(from: string, to: string, actor: string | null, name: string): Promise<void> {
		const moves = await this.taxMoves(from, to);
		const now = new Date().toISOString();
		for (const supplier of [...moves.toIntraState, ...moves.toInterState]) {
			await this.suppliers.save({
				...supplier,
				taxType: purchaseTaxType(supplier.kind, supplier.stateCode, to),
				updatedAt: now,
			});
		}
		const count = moves.toIntraState.length + moves.toInterState.length;
		if (count) {
			await this.support.record({
				actor,
				action: 'shop_details.suppliers_retaxed',
				entityType: 'shop_details',
				entityId: 'shop',
				text: `${name}'s new GSTIN moved the home State from ${gstStateName(from) ?? from} to ${gstStateName(to) ?? to}: ${charge(moves.toIntraState.length)} CGST + SGST, ${charge(moves.toInterState.length)} IGST. Draft entries take this on their next save; posted entries keep their tax.`,
				facts: {
					toIntraState: moves.toIntraState.map((supplier) => supplier.id),
					toInterState: moves.toInterState.map((supplier) => supplier.id),
				},
			});
		}
	}

	/** Registered suppliers whose tax type differs between the two home States. */
	private async taxMoves(from: string, to: string): Promise<{ toIntraState: Supplier[]; toInterState: Supplier[] }> {
		const toIntraState: Supplier[] = [];
		const toInterState: Supplier[] = [];
		for (let page = 1; ; page += 1) {
			const listed = await this.suppliers.list({ filter: 'all', page, pageSize: PAGE }, new Map());
			for (const supplier of listed.items) {
				const before = purchaseTaxType(supplier.kind, supplier.stateCode, from);
				const after = purchaseTaxType(supplier.kind, supplier.stateCode, to);
				if (before === after) continue;
				(after === 'intra_state' ? toIntraState : toInterState).push(supplier);
			}
			if (listed.items.length < PAGE) break;
		}
		return { toIntraState, toInterState };
	}

	private gstinRefusal(problem: NonNullable<ReturnType<typeof gstinProblem>>) {
		return refuse(
			problem.problem === 'check_digit' ? 'gstin_check_digit' : 'gstin_invalid',
			problem.problem === 'check_digit'
				? `The check digit is wrong: the last character should be ${problem.expected ?? ''}.`
				: 'That is not a GSTIN.',
			'gstin',
		);
	}
}
