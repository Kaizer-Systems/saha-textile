/** “10 Nov, 14:05” in the owner's time zone; “—” when there is no time. */
export function when(iso: string | null | undefined): string {
	if (!iso) return '—';
	const t = new Date(iso);
	return Number.isNaN(t.getTime())
		? '—'
		: t.toLocaleString('en-IN', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			});
}

/** “2026-12-01” or “—”. */
export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '—');
