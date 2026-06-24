/**
 * PayPal gross-up. We want the customer to pay an amount G such that, after
 * PayPal deducts its percentage + fixed fee, we net the intended `netAmount`:
 *
 *   G - (G * pct + fixed) = netAmount   =>   G = (netAmount + fixed) / (1 - pct)
 *
 * Used for non-INR currencies where PayPal is the gateway (KB §06).
 */
export function paypalGrossUp(netAmount: number, pct: number, fixed: number): number {
	if (pct < 0 || pct >= 1) throw new RangeError('pct must be in [0, 1)');
	if (netAmount < 0 || fixed < 0) throw new RangeError('amounts must be non-negative');
	return (netAmount + fixed) / (1 - pct);
}
