import { FX_LAUNCH_SYMBOLS } from '@saha-textile/core-domain';

import { CurrencyModel } from '../models/currency.model';

/**
 * Migration 0009 (shipping rules brief fx01, owner FX6): the launch currencies are written as the
 * brief writes them (US$, C$, A$, S$, NZ$, £, €). Only a stored currency still carrying the theme's
 * bare "$" changes; a symbol staff set some other way is kept. Currencies with no row stay absent:
 * the Currencies page lists them as off until a rate is typed or fetched.
 */
export async function writeLaunchCurrencySymbols(): Promise<string> {
	let written = 0;
	for (const [code, symbol] of Object.entries(FX_LAUNCH_SYMBOLS)) {
		const result = await CurrencyModel.updateOne({ _id: code, symbol: '$' }, { $set: { symbol } });
		written += result.modifiedCount;
	}
	return `wrote ${written} launch currency symbol${written === 1 ? '' : 's'}`;
}
