import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Approved legacy addresses. An unapproved row fails the seed by name.
 * The remaining sitemap rows stay out of this file until they are approved.
 */
export interface LegacyAddressRow {
	sourcePath: string;
	statusCode: 301 | 302 | 410;
	targetPath?: string;
	approved: boolean;
}

/** The reviewed map. It is data, so a change to it is a change to one reviewed file. */
export const LEGACY_ADDRESSES: readonly LegacyAddressRow[] = JSON.parse(
	readFileSync(resolve(__dirname, '../../data/legacy-addresses.json'), 'utf8'),
) as LegacyAddressRow[];

const STATIC_PAGES = new Set(['/contact-us', '/account', '/cart', '/checkout', '/blogs', '/search']);

export function approvedLegacyRows(rows: readonly LegacyAddressRow[]): LegacyAddressRow[] {
	const pending = rows.filter((row) => !row.approved);
	if (pending.length > 0) {
		throw new Error(`Unapproved legacy rows: ${pending.map((row) => row.sourcePath).join(', ')}`);
	}
	return rows.map((row) => ({ ...row, sourcePath: normaliseLegacyPath(row.sourcePath) }));
}

export function normaliseLegacyPath(path: string): string {
	const decoded = decodeURIComponent(path)
		.toLowerCase()
		.replace(/\/page\/\d+\/?$/, '');
	const pathname = decoded.replace(/\?.*$/, '');
	const bare = pathname.replace(/\/+$/, '') || '/';
	const kept = decoded
		.slice(pathname.length + 1)
		.split('&')
		.filter((part) => part && !/^(orderby|order|min_price|max_price|rating_filter|query_type_|filter_)/.test(part));
	return kept.length > 0 ? `${bare}?${kept.join('&')}` : bare;
}

/** A 301 or 302 may only point at a live collection or a page this shop already renders. */
export function legacyTargetIsLive(targetPath: string, livePaths: ReadonlySet<string>): boolean {
	const bare = targetPath.replace(/^\/(en|fr)/, '') || '/';
	if (STATIC_PAGES.has(bare)) return true;
	if (bare.startsWith('/collections/')) return livePaths.has(bare.slice('/collections/'.length));
	if (bare.startsWith('/product/')) return livePaths.has(bare);
	return false;
}
