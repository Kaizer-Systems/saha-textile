import type {
	ComingUpRow,
	PageLayout,
	PageSettings,
	PageSettingsField,
	ResolvedPageSettings,
	ScheduleEntry,
} from '@saha-textile/contracts';

/**
 * A page's own settings (Page Builder P3, SG-6, Q17 A): its search title and description, its one main heading and
 * its share picture. They belong to the page, not to a layout, so a seasonal layout never changes how the page reads
 * in search results. Like the legal pages, they save only when every shop language is filled.
 */

/** The fields every shop language must fill (the contract's `PAGE_SETTINGS_FIELDS`; core imports contracts as types). */
export const PAGE_SETTINGS_REQUIRED: readonly PageSettingsField[] = ['title', 'description', 'heading'];

const filled = (value: string | undefined): boolean => !!value && value.trim().length > 0;

/** What each language still lacks, by language; a language with nothing missing is left out. */
export function pageSettingsGaps(
	settings: Pick<PageSettings, PageSettingsField>,
	locales: readonly string[],
): Record<string, PageSettingsField[]> {
	const gaps: Record<string, PageSettingsField[]> = {};
	for (const locale of locales) {
		const missing = PAGE_SETTINGS_REQUIRED.filter((field) => !filled(settings[field][locale]));
		if (missing.length) gaps[locale] = missing;
	}
	return gaps;
}

const trimmed = (text: Readonly<Record<string, string>>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(text)
			.map(([locale, value]) => [locale, value.replace(/\s+/g, ' ').trim()] as const)
			.filter(([, value]) => value.length > 0),
	);

/** The settings as saved: words trimmed to one line each, empty languages dropped. */
export function pageSettingsToSave(settings: PageSettings): PageSettings {
	return {
		title: trimmed(settings.title),
		description: trimmed(settings.description),
		heading: trimmed(settings.heading),
		headingShown: settings.headingShown,
		shareImage: settings.shareImage ? { ...settings.shareImage } : null,
	};
}

/** The settings in one language for the shop; a missing value is null, so the shop keeps its own words for it. */
export function shopPageSettings(
	settings: PageSettings,
	locale: string,
	shareImageUrl: string | null,
): ResolvedPageSettings {
	const text = (field: PageSettingsField) => settings[field][locale]?.trim() || null;
	return {
		title: text('title'),
		description: text('description'),
		heading: text('heading'),
		headingShown: settings.headingShown,
		shareImageUrl,
	};
}

/**
 * "Coming up, across every page" (SG-17): every switch still ahead on one page, soonest first. A switch showing now
 * is listed while its end is still to come; one with no end that has started is simply what shows, and is left out.
 */
export function comingUp(
	page: { pageType: ComingUpRow['pageType']; target: string; schedule: readonly ScheduleEntry[] },
	layouts: readonly Pick<PageLayout, 'id' | 'name'>[],
	now: Date,
): ComingUpRow[] {
	const time = now.getTime();
	const names = new Map(layouts.map((layout) => [layout.id, layout.name]));
	return page.schedule
		.flatMap((entry): ComingUpRow[] => {
			const from = Date.parse(entry.from);
			const until = entry.until === null ? null : Date.parse(entry.until);
			if (until !== null && until <= time) return [];
			const state = from > time ? 'coming' : 'showing';
			if (state === 'showing' && until === null) return [];
			return [
				{
					pageType: page.pageType,
					target: page.target,
					layoutId: entry.layoutId,
					layoutName: names.get(entry.layoutId) ?? entry.layoutId,
					from: entry.from,
					until: entry.until,
					state,
				},
			];
		})
		.sort((a, b) => nextMoment(a) - nextMoment(b));
}

/** When a row next changes what shows: the end of a switch showing now, the start of one still to come. */
const nextMoment = (row: ComingUpRow): number =>
	Date.parse(row.state === 'showing' ? (row.until ?? row.from) : row.from);
