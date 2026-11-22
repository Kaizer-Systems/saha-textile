/**
 * Which paid Cloudflare plans and add-ons the domain and the account have, read live (owner, 23 Nov:
 * a plan lock's badge goes away once the account has the plan; brief legend: "Plan locks (Pro,
 * Business, add-on) keep their own badge and unlock after an upgrade"). Answered as facts, one per
 * feature, on or off, so the menu and the tabs can drop a badge the moment Cloudflare says yes.
 */
import type { ProductScreen } from './kit.js';
import { fact, view } from './kit.js';
import { cfSoft, zoneOf } from './cf-kit.js';
import { arr, rec, str } from '../vendors/http.js';

const TIERS = ['free', 'pro', 'business', 'enterprise'];

/** Feature key → on, from the plan, the subscriptions and Cloudflare's own "editable" answers. */
export async function cfFeatures(ctx: Parameters<ProductScreen['tabs'][string]>[0]): Promise<Record<string, boolean>> {
	const z = await zoneOf(ctx);
	const plan = str(rec(z.raw['plan'])['legacy_id']) || 'free';
	const at = (t: string) => TIERS.indexOf(plan) >= TIERS.indexOf(t);
	const [zoneSub, accountSubs, argo, reserve, r2] = await Promise.all([
		cfSoft(`/zones/${z.id}/subscription`, ctx.key).catch(() => null),
		cfSoft(`/accounts/${z.account}/subscriptions`, ctx.key).catch(() => null),
		cfSoft(`/zones/${z.id}/argo/smart_routing`, ctx.key).catch(() => null),
		cfSoft(`/zones/${z.id}/cache/cache_reserve`, ctx.key).catch(() => null),
		cfSoft(`/accounts/${z.account}/r2/buckets`, ctx.key).catch(() => null),
	]);
	// Every subscription's plan name and its components with a value, lower case, to look features up in.
	const subs = [rec(zoneSub), ...arr(accountSubs).map(rec)]
		.flatMap((s) => [
			str(rec(s['rate_plan'])['id']),
			str(rec(s['rate_plan'])['public_name']),
			...arr(s['component_values'])
				.map(rec)
				.filter((c) => Number(c['value'] ?? 0) > 0)
				.map((c) => str(c['name'])),
		])
		.join(' ')
		.toLowerCase();
	const has = (...words: string[]) => words.some((w) => subs.includes(w));
	return {
		'cf.pro': at('pro'),
		'cf.business': at('business'),
		'cf.enterprise': at('enterprise'),
		'cf.argo': rec(argo)['editable'] === true || has('argo'),
		'cf.lb': has('load_balanc', 'loadbalanc'),
		'cf.waiting_room': at('business') || has('waiting'),
		'cf.web3': has('web3', 'ipfs', 'ethereum'),
		'cf.images': has('images'),
		'cf.stream': has('stream'),
		'cf.logpush': at('enterprise'),
		'cf.managed_waf': at('pro'),
		'cf.health_checks': at('pro'),
		'cf.cache_reserve': rec(reserve)['editable'] === true || has('cache_reserve'),
		'cf.r2': r2 !== null,
	};
}

export const cfPlanScreen: ProductScreen = {
	vendor: 'cloudflare',
	tabs: {
		status: async (ctx) => {
			const z = await zoneOf(ctx);
			const features = await cfFeatures(ctx);
			return view({
				head: { name: z.name, status: z.plan, tone: 'cy' },
				facts: Object.entries(features).map(([k, on]) => fact(k, on ? 'on' : 'off', on ? 'ok' : null)),
			});
		},
	},
};
