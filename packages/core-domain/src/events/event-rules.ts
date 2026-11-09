import type {
	PublicShopEvent,
	ResolvedImage,
	ShopEvent,
	ShopEventProblem,
	ShopEventWrite,
} from '@saha-textile/contracts';

import { articleText } from '../blog/sanitize-html';
import { saleRuleProblem } from './sale-pricing';

const DAY_MS = 86_400_000;

/** The longest a launch's popup keeps showing, counted from the launch's start (owner, 2026-11-08). */
export const LAUNCH_POPUP_DAYS = 60;

const problem = (
	code: ShopEventProblem['code'],
	target = '',
	extra: Partial<Omit<ShopEventProblem, 'code' | 'target'>> = {},
): ShopEventProblem => ({ code, target, locale: null, gaps: [], detail: '', ...extra });

const filled = (value: string | undefined): boolean => !!value && value.trim().length > 0;

/**
 * What stops an event from being saved, whatever its state: a sale rule that can never apply,
 * or an end before the start. Everything else may stay unfinished on a draft.
 */
export function shopEventSaveProblems(type: ShopEvent['type'], body: ShopEventWrite): ShopEventProblem[] {
	const problems: ShopEventProblem[] = [];
	if (type === 'sale') {
		for (const line of body.sale.categories) {
			const bad = saleRuleProblem(line.rule);
			if (bad) problems.push(problem('bad_rule', line.categoryId, { detail: bad }));
			for (const row of line.exceptions) {
				const own = row.mode === 'own' && row.rule ? saleRuleProblem(row.rule) : null;
				if (own) problems.push(problem('bad_rule', row.productId, { detail: own }));
			}
		}
		for (const line of body.sale.products) {
			const bad = saleRuleProblem(line.rule);
			if (bad) problems.push(problem('bad_rule', line.productId, { detail: bad }));
		}
		if (body.startsAt && body.endsAt && Date.parse(body.endsAt) <= Date.parse(body.startsAt)) {
			problems.push(problem('end_before_start', 'endsAt'));
		}
	}
	return problems;
}

/**
 * What stops Publish, apart from the item checks the server runs with the catalogue (Go Live
 * gaps, overlapping sales): both languages of the title and message, a start in the future,
 * a sale's end, and at least one item.
 */
export function shopEventPublishProblems(event: ShopEvent, locales: readonly string[], now: Date): ShopEventProblem[] {
	const problems: ShopEventProblem[] = [];
	if (event.status !== 'draft') problems.push(problem('not_draft'));
	for (const locale of locales) {
		if (!filled(event.title[locale])) problems.push(problem('missing_text', `title:${locale}`, { locale }));
		// The message comes from the rich editor: an empty one still holds a bare paragraph.
		if (!filled(articleText(event.message[locale] ?? '')))
			problems.push(problem('missing_text', `message:${locale}`, { locale }));
	}
	if (!event.startsAt) problems.push(problem('missing_start', 'startsAt'));
	else if (Date.parse(event.startsAt) <= now.getTime()) problems.push(problem('start_passed', 'startsAt'));
	if (event.type === 'sale') {
		if (!event.endsAt) problems.push(problem('missing_end', 'endsAt'));
		else if (event.startsAt && Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
			problems.push(problem('end_before_start', 'endsAt'));
		}
		if (!event.sale.categories.length && !event.sale.products.length) problems.push(problem('no_items'));
	} else if (!event.launch.categoryIds.length && !event.launch.productIds.length) {
		problems.push(problem('no_items'));
	}
	return problems;
}

/** The next moment the clock must act on this event, or null when it never will again. */
export function nextBoundary(event: ShopEvent): string | null {
	if (event.status === 'scheduled') return event.startsAt;
	if (event.status === 'live' && event.type === 'sale') return event.endsAt;
	return null;
}

/** What the clock should do to this event now: start it, end it, or nothing. */
export function dueTransition(event: ShopEvent, now: Date): 'start' | 'end' | null {
	const at = now.getTime();
	if (event.status === 'scheduled' && event.startsAt && Date.parse(event.startsAt) <= at) return 'start';
	if (event.status === 'live' && event.type === 'sale' && event.endsAt && Date.parse(event.endsAt) <= at) {
		return 'end';
	}
	return null;
}

/** A sale whose prices apply at this moment. Prices follow the clock, not the status write. */
export function saleRunsAt(event: ShopEvent, now: Date): boolean {
	if (event.type !== 'sale' || !event.startsAt || !event.endsAt) return false;
	if (event.status !== 'scheduled' && event.status !== 'live') return false;
	const at = now.getTime();
	return Date.parse(event.startsAt) <= at && at < Date.parse(event.endsAt);
}

/**
 * One published event as the shop shows it at `now`, or null when the shop shows nothing.
 *
 * The top bar line lasts until a sale's end, or `nowLiveDays` after a launch's start. The popup
 * lasts until a sale's end, or 60 days after a launch's start (not the day it was published).
 */
export function publicShopEvent(
	event: ShopEvent,
	locale: string,
	now: Date,
	popupImage: ResolvedImage | null,
): PublicShopEvent | null {
	if (event.status !== 'scheduled' && event.status !== 'live') return null;
	if (!event.startsAt) return null;
	const at = now.getTime();
	const start = Date.parse(event.startsAt);
	const text = (values: Readonly<Record<string, string>>) => values[locale]?.trim() || values['en']?.trim() || '';
	let phase: PublicShopEvent['phase'];
	let countdownTo: string | null;
	let stripUntil: string | null;
	let popupUntil: string | null;
	if (event.type === 'sale') {
		if (!event.endsAt || Date.parse(event.endsAt) <= at) return null;
		phase = start > at ? 'upcoming' : 'running';
		countdownTo = phase === 'upcoming' ? event.startsAt : event.endsAt;
		stripUntil = event.endsAt;
		popupUntil = event.endsAt;
	} else {
		phase = start > at ? 'upcoming' : 'launched';
		countdownTo = phase === 'upcoming' ? event.startsAt : null;
		stripUntil = new Date(start + event.nowLiveDays * DAY_MS).toISOString();
		popupUntil = new Date(start + LAUNCH_POPUP_DAYS * DAY_MS).toISOString();
		const popupOn = event.showPopup && Date.parse(popupUntil) > at;
		const stripOn = event.showCountdown && Date.parse(stripUntil) > at;
		if (phase === 'launched' && !popupOn && !stripOn) return null;
	}
	return {
		id: event.id,
		type: event.type,
		title: text(event.title),
		message: text(event.message),
		phase,
		startsAt: event.startsAt,
		endsAt: event.type === 'sale' ? event.endsAt : null,
		countdownTo,
		popupUntil: event.showPopup ? popupUntil : null,
		stripUntil: event.showCountdown ? stripUntil : null,
		showCountdown: event.showCountdown,
		linkHref: event.linkHref,
		popupImage: event.showPopup ? popupImage : null,
	};
}
