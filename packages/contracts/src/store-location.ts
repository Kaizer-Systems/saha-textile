import { z } from 'zod';

import { Id, IsoDateTime, LocalizedText, toLatinDigits } from './common';
import { ResolvedImage } from './media';

/**
 * The shop's physical stores (owner log § stores, 2026-11-08): one card each on Contact Us, managed
 * by the super admin under Settings › Stores.
 *
 * Named "store location" so it is never confused with the NgRx store or Fastkart's marketplace
 * "store" (a vendor), which this single-vendor shop does not have. Every text is stored per
 * language; a store shows on the shop only while active, and it can be made active only when every
 * language is complete and it has at least one open day.
 */

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof Weekday>;

/** Monday first: the order the admin edits and the cards read. */
export const WEEKDAYS: readonly Weekday[] = Weekday.options;

/** A 24-hour clock time, `HH:MM`. */
export const StoreTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 10:00');
export type StoreTime = z.infer<typeof StoreTime>;

export const StoreDayHours = z
	.object({
		day: Weekday,
		open: z.boolean(),
		opens: StoreTime.nullable().default(null),
		closes: StoreTime.nullable().default(null),
	})
	.superRefine((value, ctx) => {
		if (!value.open) return;
		if (!value.opens || !value.closes) {
			ctx.addIssue({ code: 'custom', path: ['opens'], message: 'An open day needs opening and closing times' });
			return;
		}
		// Hours that run past midnight are not supported (stores brief): closing must come later.
		if (value.closes <= value.opens) {
			ctx.addIssue({ code: 'custom', path: ['closes'], message: 'Closing time must be after opening time' });
		}
	})
	.transform((value) => (value.open ? value : { ...value, opens: null, closes: null }));
export type StoreDayHours = z.infer<typeof StoreDayHours>;

/** Always seven entries, Monday to Sunday, each day once. */
export const StoreHours = z
	.array(StoreDayHours)
	.length(7)
	.refine((days) => days.every((entry, index) => entry.day === WEEKDAYS[index]), {
		message: 'Hours must list Monday to Sunday, once each, in order',
	});
export type StoreHours = z.infer<typeof StoreHours>;

/** Every day closed: where a new store starts, so it cannot go active until hours are entered. */
export const closedWeek = (): StoreHours => WEEKDAYS.map((day) => ({ day, open: false, opens: null, closes: null }));

const MAPS_HOSTS = new Set([
	'maps.app.goo.gl',
	'maps.google.com',
	'www.google.com',
	'google.com',
	'www.google.co.in',
	'google.co.in',
]);

/** Whether a link is a Google Maps link, and nothing else, so a card never links somewhere unexpected. */
export const isGoogleMapsUrl = (value: string): boolean => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	if (url.hostname === 'goo.gl') return url.pathname.startsWith('/maps');
	if (!MAPS_HOSTS.has(url.hostname)) return false;
	if (url.hostname === 'maps.app.goo.gl' || url.hostname === 'maps.google.com') return true;
	return url.pathname.startsWith('/maps');
};

/**
 * A Google Maps link: the share link (`maps.app.goo.gl`), the old short link (`goo.gl/maps`), the
 * permanent listing link (`maps.google.com/?cid=`) or any `google.com/maps` address.
 */
export const GoogleMapsUrl = z
	.string()
	.trim()
	.max(2_000)
	.refine(isGoogleMapsUrl, { message: 'Paste a Google Maps link' });
export type GoogleMapsUrl = z.infer<typeof GoogleMapsUrl>;

/** A phone number in E.164 form (`+919836663137`). */
export const E164Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use the international form, such as +919836663137');
export type E164Phone = z.infer<typeof E164Phone>;

/**
 * A phone as typed in the admin: Bengali digits become English digits, spaces, dashes and brackets
 * go, a ten-digit Indian number gains +91 and a leading 0 or 91 is folded in.
 */
export const normalisePhone = (value: string): string => {
	const digits = toLatinDigits(value).replace(/[\s\-().]/g, '');
	if (/^\+\d+$/.test(digits)) return digits;
	if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`;
	if (/^\d{10}$/.test(digits)) return `+91${digits}`;
	if (/^91\d{10}$/.test(digits)) return `+${digits}`;
	return digits;
};

/** Two-digit trunk codes of the metro landlines (Kolkata 33, Delhi 11, Mumbai 22…). */
const METRO_CODES = new Set(['11', '20', '22', '33', '40', '44', '79', '80']);

/**
 * The phone a card shows: an Indian mobile as `+91 98366 63137`, a metro landline as
 * `+91 33 2552 1595`, any other Indian number as `+91` and its digits, and the rest as stored.
 */
export const displayPhone = (e164: string): string => {
	const india = /^\+91(\d{10})$/.exec(e164)?.[1];
	if (!india) return e164;
	if (/^[6-9]/.test(india)) return `+91 ${india.slice(0, 5)} ${india.slice(5)}`;
	const code = india.slice(0, 2);
	if (METRO_CODES.has(code)) return `+91 ${code} ${india.slice(2, 6)} ${india.slice(6)}`;
	return `+91 ${india}`;
};

export const StoreGeo = z.object({
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180),
});
export type StoreGeo = z.infer<typeof StoreGeo>;

export const MAX_STORE_PHOTOS = 8;

export const StoreLocation = z.object({
	id: Id,
	name: LocalizedText,
	address: LocalizedText,
	landmark: LocalizedText.default({}),
	pinCode: z.string().regex(/^\d{6}$/),
	mapUrl: GoogleMapsUrl,
	/** Optional; used only in the page's structured data, never shown. */
	geo: StoreGeo.nullable().default(null),
	/** Optional to save; needed before the store can go active. */
	phone: E164Phone.nullable().default(null),
	hours: StoreHours,
	/** In carousel order; the first is the cover. */
	photoAssetIds: z.array(Id).max(MAX_STORE_PHOTOS).default([]),
	/** The version each photo shows, by photo id (R4-1; media step 4d). Empty: the shop's own pick. */
	imageVersions: z.record(z.string(), z.string()).default({}),
	/** Lower shows first on Contact Us. Set by dragging rows in the admin list. */
	displayOrder: z.number().int().nonnegative().default(0),
	active: z.boolean().default(false),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type StoreLocation = z.infer<typeof StoreLocation>;

// ── Admin writes ───────────────────────────────────────────────────────────────

/** The store form. `active: true` is refused, with the gaps, while anything is missing. */
export const StoreLocationWrite = z.object({
	name: z.record(z.string(), z.string().max(80)),
	address: z.record(z.string(), z.string().max(300)),
	landmark: z.record(z.string(), z.string().max(120)).default({}),
	pinCode: z
		.string()
		.transform((value) => toLatinDigits(value).replace(/\s/g, ''))
		.pipe(z.string().regex(/^\d{6}$/, 'A PIN code has six digits')),
	mapUrl: GoogleMapsUrl,
	geo: StoreGeo.nullable().default(null),
	/** Empty means not known yet; the store then stays off the shop. */
	phone: z
		.string()
		.nullish()
		.transform((value) => (value?.trim() ? normalisePhone(value) : null))
		.pipe(E164Phone.nullable()),
	hours: StoreHours,
	photoAssetIds: z.array(Id).max(MAX_STORE_PHOTOS).default([]),
	/** The version each photo shows, by photo id (R4-1; media step 4d). Empty: the shop's own pick. */
	imageVersions: z.record(z.string(), z.string()).default({}),
	active: z.boolean().default(false),
});
export type StoreLocationWrite = z.input<typeof StoreLocationWrite>;
export type StoreLocationWriteParsed = z.output<typeof StoreLocationWrite>;

/** `POST /admin/store-locations/order`: every store id, in the new order. */
export const StoreLocationOrderWrite = z.object({ ids: z.array(Id).min(1).max(200) });
export type StoreLocationOrderWrite = z.infer<typeof StoreLocationOrderWrite>;

/** `POST /admin/store-locations/:id/active`: the list's switch. */
export const StoreLocationActiveWrite = z.object({ active: z.boolean() });
export type StoreLocationActiveWrite = z.infer<typeof StoreLocationActiveWrite>;

/** A photo as the admin previews it. */
export const AdminStorePhoto = z.object({ id: Id, url: z.string() });
export type AdminStorePhoto = z.infer<typeof AdminStorePhoto>;

export const StoreLocationGap = z.object({ field: z.string(), locale: z.string().nullable() });
export type StoreLocationGap = z.infer<typeof StoreLocationGap>;

export const AdminStoreLocationRow = z.object({
	store: StoreLocation,
	photos: z.array(AdminStorePhoto),
	/** What still stops the store going active. */
	gaps: z.array(StoreLocationGap),
});
export type AdminStoreLocationRow = z.infer<typeof AdminStoreLocationRow>;

/** The answer to a save or a switch: the store, or what stops it going active. */
export const StoreLocationSaveResult = z.object({
	id: Id,
	active: z.boolean(),
	gaps: z.array(StoreLocationGap),
});
export type StoreLocationSaveResult = z.infer<typeof StoreLocationSaveResult>;

// ── Public reads (one language, resolved by the API) ───────────────────────────

export const PublicStoreLocationQuery = z.object({
	locale: z
		.string()
		.regex(/^[a-z]{2}$/)
		.default('en'),
});
export type PublicStoreLocationQuery = z.infer<typeof PublicStoreLocationQuery>;

export const PublicStoreLocation = z.object({
	id: Id,
	name: z.string(),
	address: z.string(),
	landmark: z.string().nullable(),
	pinCode: z.string(),
	mapUrl: z.string(),
	phone: z.string().nullable(),
	phoneDisplay: z.string().nullable(),
	/** Grouped for reading: "Mon–Sat 10:00–20:30, Sun closed". */
	hoursSummary: z.string(),
	/** The raw week, for the page's structured data. */
	hours: StoreHours,
	geo: StoreGeo.nullable(),
	photos: z.array(ResolvedImage),
});
export type PublicStoreLocation = z.infer<typeof PublicStoreLocation>;

// ── Opening hours, grouped ─────────────────────────────────────────────────────

interface HoursWords {
	days: Readonly<Record<Weekday, string>>;
	closed: string;
	everyDay: string;
}

const ENGLISH_HOURS: HoursWords = {
	days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
	closed: 'closed',
	everyDay: 'Every day',
};

const HOURS_WORDS: Readonly<Record<string, HoursWords>> = {
	en: ENGLISH_HOURS,
	// Weekday names in Bengali, digits in English (docs/maintenance/languages.md § Numbers).
	bn: {
		days: { mon: 'সোম', tue: 'মঙ্গল', wed: 'বুধ', thu: 'বৃহস্পতি', fri: 'শুক্র', sat: 'শনি', sun: 'রবি' },
		closed: 'বন্ধ',
		everyDay: 'প্রতিদিন',
	},
};

/**
 * Opening hours as one short line, Monday first: days next to each other with the same hours join
 * into a range ("Mon–Sat 10:00–20:30"), closed days read "Sun closed", and one pattern for the whole
 * week reads "Every day 10:00–21:00". Matching days that are not next to each other stay apart.
 */
export const summariseStoreHours = (hours: readonly StoreDayHours[], locale: string): string => {
	const words = HOURS_WORDS[locale] ?? ENGLISH_HOURS;
	const value = (entry: StoreDayHours): string => (entry.open ? `${entry.opens}–${entry.closes}` : words.closed);
	const groups: { from: Weekday; to: Weekday; value: string }[] = [];
	for (const entry of hours) {
		const current = value(entry);
		const last = groups.at(-1);
		if (last && last.value === current) last.to = entry.day;
		else groups.push({ from: entry.day, to: entry.day, value: current });
	}
	if (groups.length === 1) return `${words.everyDay} ${groups.map((group) => group.value).join('')}`;
	return groups
		.map((group) => {
			const days =
				group.from === group.to ? words.days[group.from] : `${words.days[group.from]}–${words.days[group.to]}`;
			return `${days} ${group.value}`;
		})
		.join(', ');
};
