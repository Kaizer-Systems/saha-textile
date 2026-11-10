/** 327680000 → “312.5 MB”; `null` → “—”. Binary units, as Docker shows them. */
export function formatBytes(bytes: number | null): string {
	if (bytes === null) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value >= 1000 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
