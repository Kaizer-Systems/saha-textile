import type { WrittenLanguageArea } from '@saha-textile/contracts';
import type { LanguageCoverageRepository } from '@saha-textile/core-domain';

/**
 * A list's narrowing to the items the shop shows that still lack one language's text (Settings ›
 * Languages, "Open" on a to-do line): the ids to keep, or nothing when the list is not filtered.
 */
export async function missingFilter(
	coverage: LanguageCoverageRepository | null,
	area: WrittenLanguageArea,
	code: string | undefined,
): Promise<{ ids?: string[] }> {
	if (!code || !coverage) return {};
	return { ids: await coverage.missingIds(area, code) };
}
