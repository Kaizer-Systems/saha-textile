import { EnglishName } from '@saha-textile/contracts';

/**
 * A name from Google or Facebook, kept only when it is already in English letters (BN-12).
 * Everything stored about a person by name — the profile, deliveries, staff searches — reads
 * English letters, so a name in Bengali or another script is dropped rather than stored.
 */
export function englishNameOrNothing(name: string | null | undefined): string | undefined {
	if (!name) return undefined;
	const parsed = EnglishName.safeParse(name);
	return parsed.success ? parsed.data : undefined;
}
