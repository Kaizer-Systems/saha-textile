import type {
	ShippingCondition,
	ShippingConditionGroup,
	ShippingNode,
	ShippingResult,
	ShippingRuleSetBody,
	ShippingRuleSetUse,
	ShippingStep,
} from '@saha-textile/contracts';

import { valueMatchesShape, valueShape } from './conditions';
import { SHIPPING_FIELD_TYPES, isLineField } from './facts';

/**
 * Checks run before a rule set can be made active (rb07). Errors block "Save and make active";
 * a draft can still be saved. Warnings are shown but never block. Each issue names the block it
 * is about, so the builder can point at it, and carries a code the admin translates.
 */
export type ShippingIssueCode =
	| 'no_steps'
	| 'step_empty'
	| 'branch_no_result'
	| 'group_empty'
	| 'condition_incomplete'
	| 'condition_operator'
	| 'condition_value'
	| 'condition_impossible'
	| 'line_fact_needs_loop'
	| 'amount_missing'
	| 'percent_missing'
	| 'percent_of_line_needs_loop'
	| 'first_further_needs_line_or_cart'
	| 'bands_field_missing'
	| 'bands_empty'
	| 'band_range'
	| 'bands_gap'
	| 'bands_overlap'
	| 'bands_uncovered'
	| 'adjust_amount_missing'
	| 'round_up_zero'
	| 'minimum_above_maximum'
	| 'duplicate_block_id'
	| 'cant_ship_message_missing'
	| 'charge_zone_mismatch'
	| 'courier_needed';

export interface ShippingIssue {
	code: ShippingIssueCode;
	severity: 'error' | 'warning';
	/** The block the issue is about (a step, decision, band, condition, result or adjustment id). */
	blockId: string;
	/** The step it sits in; null for adjustments and whole-body issues. */
	stepId: string | null;
	params?: Record<string, string | number>;
}

export interface ShippingValidation {
	issues: ShippingIssue[];
	/** No errors: the rule set may be made active. */
	canActivate: boolean;
}

export interface ShippingValidationOptions {
	/** The shop's languages; a can't-ship message, which shoppers read, must be written in each. */
	languages?: readonly string[];
}

export function validateShippingRuleSet(
	body: ShippingRuleSetBody,
	use: ShippingRuleSetUse = 'both',
	options: ShippingValidationOptions = {},
): ShippingValidation {
	const issues: ShippingIssue[] = [];
	const ids = new Map<string, number>();
	const seeId = (id: string): void => {
		ids.set(id, (ids.get(id) ?? 0) + 1);
	};

	if (body.steps.length === 0) issues.push({ code: 'no_steps', severity: 'error', blockId: 'body', stepId: null });

	for (const step of body.steps) {
		seeId(step.id);
		if (step.node === null) {
			issues.push({ code: 'step_empty', severity: 'error', blockId: step.id, stepId: step.id });
			continue;
		}
		checkNode(step.node, step, issues, seeId, use);
		for (const { id, message } of cantShipMessages(step.node)) {
			const missing = (options.languages ?? ['en']).filter((code) => !(message[code] ?? '').trim());
			for (const language of missing) {
				issues.push({
					code: 'cant_ship_message_missing',
					severity: 'error',
					blockId: id,
					stepId: step.id,
					params: { language },
				});
			}
		}
	}

	const adjustById = new Map(body.adjust.map((a) => [a.kind, a] as const));
	for (const adjust of body.adjust) {
		seeId(adjust.id);
		const value =
			adjust.kind === 'roundUp' ? adjust.to : adjust.kind === 'freeAbove' ? adjust.subtotal : adjust.amount;
		if (value === null)
			issues.push({ code: 'adjust_amount_missing', severity: 'error', blockId: adjust.id, stepId: null });
		else if (adjust.kind === 'roundUp' && value <= 0)
			issues.push({ code: 'round_up_zero', severity: 'error', blockId: adjust.id, stepId: null });
	}
	const min = adjustById.get('minimum');
	const max = adjustById.get('maximum');
	if (
		min?.kind === 'minimum' &&
		max?.kind === 'maximum' &&
		min.amount !== null &&
		max.amount !== null &&
		min.amount > max.amount
	) {
		issues.push({
			code: 'minimum_above_maximum',
			severity: 'error',
			blockId: min.id,
			stepId: null,
			params: { minimum: min.amount, maximum: max.amount },
		});
	}

	for (const [id, count] of ids)
		if (count > 1) issues.push({ code: 'duplicate_block_id', severity: 'error', blockId: id, stepId: null });

	return { issues, canActivate: !issues.some((i) => i.severity === 'error') };
}

function checkNode(
	node: ShippingNode,
	step: ShippingStep,
	issues: ShippingIssue[],
	seeId: (id: string) => void,
	use: ShippingRuleSetUse,
): void {
	seeId(node.id);
	const stepId = step.id;
	const child = (next: ShippingNode | null, branchId: string, which: string): void => {
		if (next === null)
			issues.push({
				code: 'branch_no_result',
				severity: 'error',
				blockId: branchId,
				stepId,
				params: { branch: which },
			});
		else checkNode(next, step, issues, seeId, use);
	};
	switch (node.kind) {
		case 'result':
			checkResult(node.result, node.id, step, issues, use);
			return;
		case 'if':
			checkGroup(node.when, step, issues, seeId, true);
			child(node.then, node.id, 'then');
			child(node.otherwise, node.id, 'otherwise');
			return;
		case 'bands': {
			if (node.field === null)
				issues.push({ code: 'bands_field_missing', severity: 'error', blockId: node.id, stepId });
			else if (isLineField(node.field) && step.scope === 'wholeCart') {
				issues.push({
					code: 'line_fact_needs_loop',
					severity: 'error',
					blockId: node.id,
					stepId,
					params: { field: node.field },
				});
			}
			if (node.bands.length === 0)
				issues.push({ code: 'bands_empty', severity: 'error', blockId: node.id, stepId });
			for (const band of node.bands) {
				seeId(band.id);
				if (band.from !== null && band.to !== null && band.from >= band.to) {
					issues.push({
						code: 'band_range',
						severity: 'error',
						blockId: band.id,
						stepId,
						params: { from: band.from, to: band.to },
					});
				}
				child(band.then, band.id, 'band');
			}
			const sorted = [...node.bands].sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
			for (let i = 1; i < sorted.length; i += 1) {
				const prev = sorted[i - 1];
				const cur = sorted[i];
				if (!prev || !cur) continue;
				const prevTo = prev.to ?? Infinity;
				const curFrom = cur.from ?? -Infinity;
				if (curFrom > prevTo)
					issues.push({
						code: 'bands_gap',
						severity: 'error',
						blockId: cur.id,
						stepId,
						params: { from: prevTo, to: curFrom },
					});
				if (curFrom < prevTo)
					issues.push({
						code: 'bands_overlap',
						severity: 'error',
						blockId: cur.id,
						stepId,
						params: { from: curFrom, to: prevTo },
					});
			}
			const first = sorted[0];
			const last = sorted[sorted.length - 1];
			const lowOpen = first !== undefined && first.from !== null && first.from > 0;
			const highOpen = last !== undefined && last.to !== null;
			if ((lowOpen || highOpen) && node.otherwise === null) {
				issues.push({
					code: 'bands_uncovered',
					severity: 'error',
					blockId: node.id,
					stepId,
					params: {
						below: lowOpen && first ? (first.from ?? 0) : -1,
						above: highOpen && last ? (last.to ?? 0) : -1,
					},
				});
			}
			if (node.otherwise !== null) checkNode(node.otherwise, step, issues, seeId, use);
			return;
		}
	}
}

function checkGroup(
	group: ShippingConditionGroup,
	step: ShippingStep,
	issues: ShippingIssue[],
	seeId: (id: string) => void,
	top: boolean,
): void {
	seeId(group.id);
	if (group.items.length === 0)
		issues.push({
			code: 'group_empty',
			severity: 'error',
			blockId: group.id,
			stepId: step.id,
			params: { top: top ? 1 : 0 },
		});
	for (const item of group.items) {
		if (item.kind === 'group') checkGroup(item, step, issues, seeId, false);
		else checkCondition(item, step, issues, seeId);
	}
}

function checkCondition(
	condition: ShippingCondition,
	step: ShippingStep,
	issues: ShippingIssue[],
	seeId: (id: string) => void,
): void {
	seeId(condition.id);
	const stepId = step.id;
	const { field, op, value } = condition;
	if (field === null || op === null || value === null) {
		issues.push({ code: 'condition_incomplete', severity: 'error', blockId: condition.id, stepId });
		return;
	}
	if (isLineField(field) && step.scope === 'wholeCart') {
		issues.push({
			code: 'line_fact_needs_loop',
			severity: 'error',
			blockId: condition.id,
			stepId,
			params: { field },
		});
	}
	const type = SHIPPING_FIELD_TYPES[field];
	const shape = valueShape(type, op);
	if (shape === null) {
		issues.push({
			code: 'condition_operator',
			severity: 'error',
			blockId: condition.id,
			stepId,
			params: { field, op },
		});
		return;
	}
	if (!valueMatchesShape(value, shape)) {
		issues.push({
			code: 'condition_value',
			severity: 'error',
			blockId: condition.id,
			stepId,
			params: { field, op },
		});
		return;
	}
	if (impossible(type, op, value, field)) {
		issues.push({
			code: 'condition_impossible',
			severity: 'error',
			blockId: condition.id,
			stepId,
			params: { field, op },
		});
	}
}

/** Conditions that can never hold: a discount above 100 %, a negative count, a backwards range. */
function impossible(type: string, op: string, value: unknown, field: string): boolean {
	if (op === 'between') {
		const [lo, hi] = value as [number, number];
		if (lo > hi) return true;
		if (type === 'percent' && lo > 100) return true;
		return hi < 0 && type !== 'pincode';
	}
	if (typeof value !== 'number') return false;
	if (type === 'percent') {
		if ((op === 'moreThan' && value >= 100) || (op === 'atLeast' && value > 100) || (op === 'is' && value > 100))
			return true;
		if ((op === 'lessThan' && value <= 0) || (op === 'atMost' && value < 0)) return true;
	}
	if (type === 'number' || type === 'money' || type === 'grams') {
		if ((op === 'lessThan' && value <= 0) || (op === 'atMost' && value < 0) || (op === 'is' && value < 0))
			return true;
		if (
			(field === 'line.quantity' || field === 'cart.units' || field === 'cart.lines') &&
			op === 'lessThan' &&
			value <= 1
		)
			return true;
	}
	return false;
}

function checkResult(
	result: ShippingResult,
	blockId: string,
	step: ShippingStep,
	issues: ShippingIssue[],
	use: ShippingRuleSetUse,
): void {
	const stepId = step.id;
	const zoneOf = (charge: string): 'domestic' | 'international' =>
		charge === 'domestic' ? 'domestic' : 'international';
	const mismatch = (charge: string): void => {
		if (use !== 'both' && zoneOf(charge) !== use) {
			issues.push({
				code: 'charge_zone_mismatch',
				severity: 'warning',
				blockId,
				stepId,
				params: { charge, use },
			});
		}
	};
	switch (result.kind) {
		case 'amount':
			if (result.amount === null) issues.push({ code: 'amount_missing', severity: 'error', blockId, stepId });
			return;
		case 'percent':
			if (result.percent === null) issues.push({ code: 'percent_missing', severity: 'error', blockId, stepId });
			if (result.of === 'line' && step.scope === 'wholeCart')
				issues.push({ code: 'percent_of_line_needs_loop', severity: 'error', blockId, stepId });
			return;
		case 'productCharge':
			mismatch(result.charge);
			return;
		case 'firstAndFurther':
			if (step.scope === 'eachUnit')
				issues.push({ code: 'first_further_needs_line_or_cart', severity: 'error', blockId, stepId });
			for (const source of [result.first, result.further]) {
				if (source.from === 'fixed' && source.amount === null)
					issues.push({ code: 'amount_missing', severity: 'error', blockId, stepId });
				if (source.from === 'product') mismatch(source.charge);
			}
			return;
		case 'courierQuote':
			issues.push({ code: 'courier_needed', severity: 'warning', blockId, stepId });
			return;
		case 'free':
		case 'cantShip':
			return;
	}
}

/** Every can't-ship result under a node, with the message shoppers read. */
function cantShipMessages(node: ShippingNode | null): Array<{ id: string; message: Record<string, string> }> {
	if (node === null) return [];
	switch (node.kind) {
		case 'result':
			return node.result.kind === 'cantShip' ? [{ id: node.id, message: node.result.message }] : [];
		case 'if':
			return [...cantShipMessages(node.then), ...cantShipMessages(node.otherwise)];
		case 'bands':
			return [...node.bands.flatMap((band) => cantShipMessages(band.then)), ...cantShipMessages(node.otherwise)];
	}
}
