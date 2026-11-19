import type {
	LocalizedText,
	ShippingCartSnapshot,
	ShippingException,
	ShippingExceptionChoice,
	ShippingRuleSetBody,
	ShippingSettings,
	ShippingSnapshotLine,
	ShippingTraceEntry,
	ShippingZone,
} from '@saha-textile/contracts';

import { evaluateShippingRuleSet, roundINR, type ShippingAdjustTrace, type ShippingNoResult } from './engine';
import { cartFacts } from './facts';

/**
 * Prices a whole cart's shipping (owner, 2026-11-19; brief "Logic" table):
 * - the delivery address decides the zone against the home country, never the currency;
 * - each line goes to a rule set: the product's Free shipping switch → the product's exception →
 *   its main category's → the main category's parents' (nearest first, when they include
 *   sub-categories) → the zone's site-wide choice;
 * - each rule set prices its own lines; the totals are added up, or only the highest is charged;
 * - nothing is ever silently ₹0: a missing rule set or a branch with no result stops checkout.
 */

export function shippingZoneFor(deliveryCountry: string, homeCountry: string): ShippingZone {
	return deliveryCountry.trim().toUpperCase() === homeCountry.trim().toUpperCase() ? 'domestic' : 'international';
}

/** Why a line ended up where it did. */
export type ShippingVia =
	| { kind: 'freeShippingSwitch' }
	| { kind: 'productException'; exceptionId: string }
	| { kind: 'categoryException'; exceptionId: string; categoryId: string; inherited: boolean }
	| { kind: 'siteWide' }
	| { kind: 'indiaOnly' };

export type ShippingLineRoute =
	| { kind: 'ruleSet'; ruleSetId: string; via: ShippingVia }
	| { kind: 'courier'; courierId: string; fallbackRuleSetId: string | null; via: ShippingVia }
	| { kind: 'free'; via: ShippingVia }
	| { kind: 'cantShip'; via: ShippingVia }
	| { kind: 'noMethod'; via: ShippingVia };

function choiceFor(exception: ShippingException, zone: ShippingZone): ShippingExceptionChoice {
	return zone === 'domestic' ? exception.domestic : exception.international;
}

/** Which rule set (or free / can't ship) one line falls under in a zone. */
export function routeShippingLine(
	line: Pick<ShippingSnapshotLine, 'productId' | 'mainCategoryId' | 'mainCategoryAncestorIds' | 'freeShipping'>,
	zone: ShippingZone,
	settings: Pick<ShippingSettings, 'domestic' | 'international' | 'abroadPolicy'>,
	exceptions: readonly ShippingException[],
): ShippingLineRoute {
	if (zone === 'international' && settings.abroadPolicy === 'indiaOnly')
		return { kind: 'cantShip', via: { kind: 'indiaOnly' } };
	if (line.freeShipping) return { kind: 'free', via: { kind: 'freeShippingSwitch' } };

	const fromChoice = (choice: ShippingExceptionChoice, via: ShippingVia): ShippingLineRoute | null => {
		switch (choice.kind) {
			case 'siteWide':
				return null;
			case 'ruleSet':
				return { kind: 'ruleSet', ruleSetId: choice.ruleSetId, via };
			case 'free':
				return { kind: 'free', via };
			case 'cantShip':
				return { kind: 'cantShip', via };
		}
	};

	for (const exception of exceptions) {
		if (exception.target.kind === 'product' && exception.target.productId === line.productId) {
			const route = fromChoice(choiceFor(exception, zone), {
				kind: 'productException',
				exceptionId: exception.id,
			});
			if (route) return route;
		}
	}
	if (line.mainCategoryId !== null) {
		const chain = [line.mainCategoryId, ...line.mainCategoryAncestorIds];
		for (let i = 0; i < chain.length; i += 1) {
			const categoryId = chain[i];
			for (const exception of exceptions) {
				if (exception.target.kind !== 'category' || exception.target.categoryId !== categoryId) continue;
				if (i > 0 && !exception.target.includeSubcategories) continue;
				const route = fromChoice(choiceFor(exception, zone), {
					kind: 'categoryException',
					exceptionId: exception.id,
					categoryId,
					inherited: i > 0,
				});
				if (route) return route;
			}
		}
	}

	const method = zone === 'domestic' ? settings.domestic : settings.international;
	if (method.kind === 'courier') {
		return {
			kind: 'courier',
			courierId: method.courierId,
			fallbackRuleSetId: method.fallbackRuleSetId,
			via: { kind: 'siteWide' },
		};
	}
	return method.ruleSetId === null
		? { kind: 'noMethod', via: { kind: 'siteWide' } }
		: { kind: 'ruleSet', ruleSetId: method.ruleSetId, via: { kind: 'siteWide' } };
}

export interface ActiveRuleSet {
	ruleSetId: string;
	version: number;
	body: ShippingRuleSetBody;
}

export interface ShippingPricingInput {
	snapshot: ShippingCartSnapshot;
	settings: ShippingSettings;
	exceptions: readonly ShippingException[];
	/** The active version of every rule set the cart may need, by id. */
	ruleSets: ReadonlyMap<string, ActiveRuleSet>;
	/** The courier's quote for the zone, when one was asked for and answered (rupees); null = no quote. */
	courierQuoteINR?: number | null;
}

export interface ShippingGroupResult {
	kind: 'ruleSet' | 'free' | 'courier';
	ruleSetId: string | null;
	version: number | null;
	lineIds: string[];
	amountINR: number;
	trace: ShippingTraceEntry[];
	adjustments: ShippingAdjustTrace[];
	/** True when a courier was set but gave no quote, so its fallback rule set priced the lines. */
	usedFallback: boolean;
}

export type ShippingPricingProblem =
	| { kind: 'noMethod'; lineIds: string[] }
	| { kind: 'missingRuleSet'; ruleSetId: string; lineIds: string[] }
	| { kind: 'noResult'; ruleSetId: string; where: ShippingNoResult[] }
	| { kind: 'needsQuote'; ruleSetId: string; lineIds: string[] };

export type ShippingPricingOutcome =
	| {
			status: 'priced';
			zone: ShippingZone;
			amountINR: number;
			groups: ShippingGroupResult[];
			routes: Record<string, ShippingLineRoute>;
	  }
	| {
			status: 'cantShip';
			zone: ShippingZone;
			lines: Array<{ lineId: string; via: ShippingVia; message: LocalizedText | null }>;
			routes: Record<string, ShippingLineRoute>;
	  }
	| {
			status: 'unpriced';
			zone: ShippingZone;
			problems: ShippingPricingProblem[];
			routes: Record<string, ShippingLineRoute>;
	  };

export function priceShipping(input: ShippingPricingInput): ShippingPricingOutcome {
	const { snapshot, settings, exceptions, ruleSets } = input;
	const zone = shippingZoneFor(snapshot.delivery.country, settings.homeCountry);
	const cart = cartFacts(snapshot);
	const routes: Record<string, ShippingLineRoute> = {};
	for (const line of snapshot.lines) routes[line.lineId] = routeShippingLine(line, zone, settings, exceptions);

	const cantShip: Array<{ lineId: string; via: ShippingVia; message: LocalizedText | null }> = [];
	const problems: ShippingPricingProblem[] = [];
	const groups: ShippingGroupResult[] = [];
	const byRuleSet = new Map<string, { lineIds: string[]; fallback: boolean }>();
	const freeLines: string[] = [];
	const courierLines: string[] = [];
	const noMethod: string[] = [];

	for (const line of snapshot.lines) {
		const route = routes[line.lineId];
		if (!route) continue;
		switch (route.kind) {
			case 'free':
				freeLines.push(line.lineId);
				break;
			case 'cantShip':
				cantShip.push({ lineId: line.lineId, via: route.via, message: null });
				break;
			case 'noMethod':
				noMethod.push(line.lineId);
				break;
			case 'courier':
				if (input.courierQuoteINR !== null && input.courierQuoteINR !== undefined)
					courierLines.push(line.lineId);
				else if (route.fallbackRuleSetId === null) noMethod.push(line.lineId);
				else addTo(byRuleSet, route.fallbackRuleSetId, line.lineId, true);
				break;
			case 'ruleSet':
				addTo(byRuleSet, route.ruleSetId, line.lineId, false);
				break;
		}
	}

	if (noMethod.length > 0) problems.push({ kind: 'noMethod', lineIds: noMethod });
	if (freeLines.length > 0)
		groups.push({
			kind: 'free',
			ruleSetId: null,
			version: null,
			lineIds: freeLines,
			amountINR: 0,
			trace: [],
			adjustments: [],
			usedFallback: false,
		});
	if (courierLines.length > 0) {
		const method = zone === 'domestic' ? settings.domestic : settings.international;
		let amount = input.courierQuoteINR ?? 0;
		// On top of a quote (brief cr01): a percentage of the quote, then a fixed amount.
		if (method.kind === 'courier') amount += (amount * method.extra.percent) / 100 + method.extra.amountINR;
		groups.push({
			kind: 'courier',
			ruleSetId: null,
			version: null,
			lineIds: courierLines,
			amountINR: roundINR(amount),
			trace: [],
			adjustments: [],
			usedFallback: false,
		});
	}

	for (const [ruleSetId, group] of byRuleSet) {
		const ruleSet = ruleSets.get(ruleSetId);
		if (!ruleSet) {
			problems.push({ kind: 'missingRuleSet', ruleSetId, lineIds: group.lineIds });
			continue;
		}
		const outcome = evaluateShippingRuleSet({ body: ruleSet.body, snapshot, zone, lineIds: group.lineIds, cart });
		switch (outcome.status) {
			case 'priced':
				groups.push({
					kind: 'ruleSet',
					ruleSetId,
					version: ruleSet.version,
					lineIds: group.lineIds,
					amountINR: outcome.amountINR,
					trace: outcome.trace,
					adjustments: outcome.adjustments,
					usedFallback: group.fallback,
				});
				break;
			case 'cantShip':
				for (const line of outcome.lines)
					cantShip.push({
						lineId: line.lineId,
						via: routes[line.lineId]?.via ?? { kind: 'siteWide' },
						message: line.message,
					});
				break;
			case 'noResult':
				problems.push({ kind: 'noResult', ruleSetId, where: outcome.where });
				break;
			case 'needsQuote':
				problems.push({ kind: 'needsQuote', ruleSetId, lineIds: outcome.lineIds });
				break;
		}
	}

	if (cantShip.length > 0) return { status: 'cantShip', zone, lines: cantShip, routes };
	if (problems.length > 0) return { status: 'unpriced', zone, problems, routes };

	const amounts = groups.map((g) => g.amountINR);
	const amountINR =
		amounts.length === 0
			? 0
			: settings.mixedRuleSets === 'highest'
				? Math.max(...amounts)
				: amounts.reduce((s, v) => s + v, 0);
	return { status: 'priced', zone, amountINR: roundINR(amountINR), groups, routes };
}

function addTo(
	map: Map<string, { lineIds: string[]; fallback: boolean }>,
	id: string,
	lineId: string,
	fallback: boolean,
): void {
	const entry = map.get(id);
	if (entry) {
		entry.lineIds.push(lineId);
		entry.fallback ||= fallback;
	} else map.set(id, { lineIds: [lineId], fallback });
}
