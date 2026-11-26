/**
 * A small load generator for staging and the local stack (never production): `shoppers` loops each
 * fetching the pages in turn for `seconds`, and the answer is how many requests went through, how
 * fast (p50, p95) and how many failed.
 */
export interface LoadResult {
	requests: number;
	errors: number;
	p50: number;
	p95: number;
}

const at = (sorted: number[], q: number) =>
	// The index is clamped to the list, so it always names a time.
	sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number) : 0;

export async function runLoad(base: string, paths: string[], shoppers: number, seconds: number): Promise<LoadResult> {
	const end = Date.now() + seconds * 1000;
	const times: number[] = [];
	let errors = 0;
	const shopper = async (n: number) => {
		let i = n;
		while (Date.now() < end) {
			const path = paths[i++ % paths.length] ?? '/';
			const t0 = performance.now();
			try {
				const res = await fetch(`${base}${path}`, {
					headers: { 'user-agent': 'release-console-load-test' },
					signal: AbortSignal.timeout(15_000),
				});
				await res.arrayBuffer();
				if (res.status >= 500) errors++;
			} catch {
				errors++;
			}
			times.push(performance.now() - t0);
		}
	};
	await Promise.all(Array.from({ length: shoppers }, (_, n) => shopper(n)));
	const sorted = times.sort((a, b) => a - b);
	return { requests: times.length, errors, p50: at(sorted, 0.5), p95: at(sorted, 0.95) };
}
