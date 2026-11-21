/**
 * A set's price, following the price setting each set has in admin (owner, 21 Nov 2026: "Follow each set's
 * price setting"):
 *
 * - `fixed_bundle_price`: the fixed price. A pick dearer than its group's included piece adds the difference;
 *   a cheaper pick changes nothing ("Included").
 * - `sum_components`: what the chosen pieces cost.
 * - `discounted_components`: what the chosen pieces cost after each piece's own adjustment.
 *
 * Under every setting an optional piece adds its own price when switched on.
 *
 * A group is a choice when it holds more pieces than may be taken; its first `maxSelections` pieces are the
 * included ones, chosen until the shopper picks others. Outside a choice group a piece that is not required is an
 * optional extra, off until switched on. The API prices the set and each piece's change with these rules, and the
 * shop adds up the shopper's picks with the same ones; no price is stored per choice.
 */

export type SetPricePolicy = 'sum_components' | 'fixed_bundle_price' | 'discounted_components';

export interface SetPricePiece {
	id: string;
	/** The piece's own selling price, per unit. */
	priceINR: number;
	quantity: number;
	required: boolean;
	/** Taken off each unit under `discounted_components`. */
	adjustmentINR?: number | null;
}

export interface SetPriceGroup {
	code: string;
	maxSelections: number;
	pieces: readonly SetPricePiece[];
}

export interface SetPricing {
	policy: SetPricePolicy;
	/** The set's own price under `fixed_bundle_price`; without one the set costs what its pieces cost. */
	fixedPriceINR: number | null;
	groups: readonly SetPriceGroup[];
}

/** What the shopper chose: each choice group's picked piece ids, and the optional pieces switched on. */
export interface SetChoice {
	picks?: Readonly<Record<string, readonly string[]>>;
	extras?: readonly string[];
}

export const isChoiceGroup = (group: SetPriceGroup): boolean => group.pieces.length > group.maxSelections;

export const isOptionalPiece = (group: SetPriceGroup, piece: SetPricePiece): boolean =>
	!isChoiceGroup(group) && !piece.required;

/** A choice group's included pieces: its first `maxSelections`. Other groups have none to choose. */
export const includedPicks = (group: SetPriceGroup): string[] =>
	isChoiceGroup(group) ? group.pieces.slice(0, group.maxSelections).map((piece) => piece.id) : [];

/** What one piece adds to a set priced by its pieces: its price (less its adjustment when discounted) times quantity. */
export function piecePriceINR(policy: SetPricePolicy, piece: SetPricePiece): number {
	const unit =
		policy === 'discounted_components' ? Math.max(0, piece.priceINR - (piece.adjustmentINR ?? 0)) : piece.priceINR;
	return unit * piece.quantity;
}

/** A choice group's picks as the set takes them: its own pieces, at most `maxSelections`, else the included ones. */
export function picksFor(group: SetPriceGroup, asked: readonly string[] | undefined): string[] {
	if (!isChoiceGroup(group)) return [];
	const known = new Set(group.pieces.map((piece) => piece.id));
	const picks = [...new Set((asked ?? []).filter((id) => known.has(id)))].slice(0, group.maxSelections);
	return picks.length ? picks : includedPicks(group);
}

/** The pieces the set holds for a choice: the required ones, each group's picks and the optional ones switched on. */
export function chosenPieces(pricing: SetPricing, choice: SetChoice = {}): string[] {
	const extras = new Set(choice.extras ?? []);
	return pricing.groups.flatMap((group) =>
		isChoiceGroup(group)
			? picksFor(group, choice.picks?.[group.code])
			: group.pieces.filter((piece) => piece.required || extras.has(piece.id)).map((piece) => piece.id),
	);
}

export function setPriceINR(pricing: SetPricing, choice: SetChoice = {}): number {
	const fixed = pricing.policy === 'fixed_bundle_price' && pricing.fixedPriceINR !== null;
	const extras = new Set(choice.extras ?? []);
	let total = fixed ? (pricing.fixedPriceINR ?? 0) : 0;
	for (const group of pricing.groups) {
		const priceOf = (ids: readonly string[]) =>
			group.pieces
				.filter((piece) => ids.includes(piece.id))
				.reduce((sum, piece) => sum + piecePriceINR(pricing.policy, piece), 0);
		if (isChoiceGroup(group)) {
			const chosen = priceOf(picksFor(group, choice.picks?.[group.code]));
			total += fixed ? Math.max(0, chosen - priceOf(includedPicks(group))) : chosen;
			continue;
		}
		for (const piece of group.pieces) {
			if (piece.required ? !fixed : extras.has(piece.id)) total += piecePriceINR(pricing.policy, piece);
		}
	}
	return total;
}

/**
 * What choosing one piece changes against the set's own price (its included picks, no optional piece): for a
 * choice group, taking it in place of the last included piece; for an optional piece, switching it on. Zero for an
 * included or a required piece.
 */
export function pieceChangeINR(pricing: SetPricing, groupCode: string, pieceId: string): number {
	const group = pricing.groups.find((candidate) => candidate.code === groupCode);
	const piece = group?.pieces.find((candidate) => candidate.id === pieceId);
	if (!group || !piece) return 0;
	const base = setPriceINR(pricing);
	if (isChoiceGroup(group)) {
		const included = includedPicks(group);
		if (included.includes(pieceId)) return 0;
		return setPriceINR(pricing, { picks: { [groupCode]: [...included.slice(0, -1), pieceId] } }) - base;
	}
	return piece.required ? 0 : setPriceINR(pricing, { extras: [pieceId] }) - base;
}
