/**
 * One published event as `GET /catalog/events` sends it, in the page's language. Mirrors
 * `PublicShopEvent` in `@saha-textile/contracts`, which this app does not depend on.
 */
export interface ShopEventImageSource {
	url: string;
	width: number;
	height: number;
}

export interface ShopEventImage {
	width: number;
	height: number;
	alt: string;
	roles: Record<string, ShopEventImageSource[]>;
}

export interface ShopEvent {
	id: string;
	type: 'launch' | 'sale';
	title: string;
	message: string;
	phase: 'upcoming' | 'running' | 'launched';
	startsAt: string;
	endsAt: string | null;
	countdownTo: string | null;
	popupUntil: string | null;
	stripUntil: string | null;
	showCountdown: boolean;
	linkHref: string | null;
	popupImage: ShopEventImage | null;
}

export interface ShopEventsResponse {
	serverNow: string;
	items: ShopEvent[];
}
