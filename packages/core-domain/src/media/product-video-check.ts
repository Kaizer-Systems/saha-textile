import type { ProductRepository } from '../ports/catalog.repository';
import type { YouTubePort } from '../ports/youtube.port';

/** `videos.list` answers at most 50 ids per call (1 quota unit). */
const BATCH = 50;

/**
 * The weekly product-video check (video page brief, 2026-11-10). Asks YouTube about every
 * video on every product, 50 at a time. One it no longer plays gets `unavailableSince`, so the
 * product page hides it and admin shows it as gone; one that plays again is cleared. Only
 * products whose marks changed are saved.
 */
export const checkProductVideos = async (deps: {
	products: Pick<ProductRepository, 'listWithVideos' | 'save'>;
	youtube: Pick<YouTubePort, 'describeVideos'>;
	now: () => Date;
}): Promise<{ checked: number; gone: number; back: number; products: number }> => {
	const products = await deps.products.listWithVideos();
	const ids = [...new Set(products.flatMap((product) => product.videos.map((video) => video.videoId)))];
	const playable = new Set<string>();
	for (let at = 0; at < ids.length; at += BATCH) {
		const found = await deps.youtube.describeVideos(ids.slice(at, at + BATCH));
		for (const video of found) playable.add(video.videoId);
	}
	const today = deps.now().toISOString();
	let gone = 0;
	let back = 0;
	let saved = 0;
	for (const product of products) {
		let changed = false;
		const videos = product.videos.map((video) => {
			const plays = playable.has(video.videoId);
			if (!plays && !video.unavailableSince) {
				gone += 1;
				changed = true;
				return { ...video, unavailableSince: today };
			}
			if (plays && video.unavailableSince) {
				back += 1;
				changed = true;
				return { ...video, unavailableSince: null };
			}
			return video;
		});
		if (changed) {
			await deps.products.save({ ...product, videos });
			saved += 1;
		}
	}
	return { checked: ids.length, gone, back, products: saved };
};
