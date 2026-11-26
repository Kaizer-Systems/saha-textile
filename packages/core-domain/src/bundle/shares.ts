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
	const weightSum = pieces.reduce((sum, piece) => sum + Math.max(0, piece.weightINR), 0);
	const parts = pieces.map((piece) => {
		const weight = Math.max(0, piece.weightINR);
		const raw = weightSum > 0 ? (totalPaise * weight) / weightSum : totalPaise / pieces.length;
		return { key: piece.key, weight, frac: raw - Math.floor(raw), paise: Math.floor(raw) };
	});
	let remainder = totalPaise - parts.reduce((sum, part) => sum + part.paise, 0);
	// Hand out the leftover paise by largest fractional part, ties to the heavier piece.
	for (const part of [...parts].sort((a, b) => b.frac - a.frac || b.weight - a.weight)) {
		if (remainder <= 0) break;
		part.paise += 1;
		remainder -= 1;
	}
	for (const part of parts) out.set(part.key, part.paise / 100);
	return out;
}
