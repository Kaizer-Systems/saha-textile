/**
 * The name a review shows publicly: the first name and the first letter of the last name
 * ("Riya S."). A single name stays as it is; no name gives an empty string, and the shop
 * then shows its own word for "a customer". Nothing else about the reviewer is public.
 */
export function publicReviewerName(displayName: string | null | undefined): string {
	const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '';
	const first = parts[0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
	return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}
