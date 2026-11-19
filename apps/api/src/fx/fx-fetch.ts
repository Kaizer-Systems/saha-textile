import { FxSettings, type FxFetchResult } from '@saha-textile/contracts';
import {
	type CurrencyRepository,
	type FxRatePort,
	type SiteSettingsRepository,
	applyFetchedRates,
	isDailyFetchDue,
} from '@saha-textile/core-domain';

export interface FxFetchDeps {
	settings: Pick<SiteSettingsRepository, 'get' | 'set'>;
	currencies: Pick<CurrencyRepository, 'listAll' | 'upsert'>;
	fx: Pick<FxRatePort, 'getAllRatesFromINR'>;
}

export async function readFxSettings(settings: Pick<SiteSettingsRepository, 'get'>): Promise<FxSettings> {
	return FxSettings.parse((await settings.get('fx')) ?? {});
}

/**
 * Fetches today's rates and stores them (brief fx01: the daily fetch and "Fetch now"). A failure
 * keeps the stored rates in use and is recorded in plain words; the next check tries again. Only
 * this step's fields are written, read fresh, so an admin's change a moment earlier is kept.
 */
export async function fetchRatesNow(deps: FxFetchDeps, now = new Date()): Promise<FxFetchResult> {
	const at = now.toISOString();
	try {
		const rates = await deps.fx.getAllRatesFromINR();
		const updated = applyFetchedRates(await deps.currencies.listAll(), rates, now);
		for (const currency of updated) await deps.currencies.upsert(currency);
		const latest = await readFxSettings(deps.settings);
		await deps.settings.set('fx', {
			...latest,
			dailyFetch: { ...latest.dailyFetch, lastRunAt: at, lastError: null },
		});
		return { ok: true, updated: updated.map((c) => c.code), problem: null, at };
	} catch (error) {
		const problem = (error instanceof Error ? error.message : String(error)).slice(0, 300);
		const latest = await readFxSettings(deps.settings);
		await deps.settings.set('fx', { ...latest, dailyFetch: { ...latest.dailyFetch, lastError: problem } });
		return { ok: false, updated: [], problem, at };
	}
}

/** The worker's check every 15 minutes: fetch when the daily fetch is on and its India time has come. */
export async function fetchRatesIfDue(deps: FxFetchDeps, now = new Date()): Promise<FxFetchResult | null> {
	if (!isDailyFetchDue(await readFxSettings(deps.settings), now)) return null;
	return fetchRatesNow(deps, now);
}
