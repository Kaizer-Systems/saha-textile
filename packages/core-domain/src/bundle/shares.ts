/**
 * Each piece of a set is billed on its own line at its share of the set price, the share in proportion to the
 * piece's Price in this set (owner-final, 22 Nov 2026, concern 1). Shares are in paise and always add up to the set
 * price exactly: the rounding remainder goes to the largest piece. Pieces with no weight (all zero) share equally.
 */
export function splitShares(
	setPriceINR: number,
	pieces: readonly { key: string; weightINR: number }[],
): Map<string, number> {
	const out = new Map<string, number>();
	if (pieces.length === 0) return out;
	const totalPaise = Math.round(setPriceINR * 100);
	const weights = pieces.map((piece) => Math.max(0, piece.weightINR));
	const weightSum = weights.reduce((sum, w) => sum + w, 0);
	const raw = weights.map((weight) =>
		weightSum > 0 ? (totalPaise * weight) / weightSum : totalPaise / pieces.length,
	);
	const floored = raw.map(Math.floor);
	let remainder = totalPaise - floored.reduce((sum, p) => sum + p, 0);
	// Hand out the leftover paise by largest fractional part, ties to the heavier piece.
	const order = raw
		.map((value, at) => ({ at, frac: value - Math.floor(value), weight: weights[at] ?? 0 }))
		.sort((a, b) => b.frac - a.frac || b.weight - a.weight);
	for (const { at } of order) {
		if (remainder <= 0) break;
		floored[at] = (floored[at] ?? 0) + 1;
		remainder -= 1;
	}
	pieces.forEach((piece, at) => out.set(piece.key, (floored[at] ?? 0) / 100));
	return out;
}
