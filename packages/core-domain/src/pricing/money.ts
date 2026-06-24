/** Round a monetary amount to a fixed number of decimals (default 2). */
export function roundMoney(amount: number, decimals = 2): number {
	if (!Number.isFinite(amount)) throw new RangeError('amount must be finite');
	const factor = 10 ** decimals;
	return Math.round((amount + Number.EPSILON) * factor) / factor;
}

/** Convert a canonical INR amount into another currency using its rateFromINR. */
export function convertFromINR(amountINR: number, rateFromINR: number): number {
	if (rateFromINR <= 0) throw new RangeError('rateFromINR must be positive');
	if (amountINR < 0) throw new RangeError('amountINR must be non-negative');
	return amountINR * rateFromINR;
}
