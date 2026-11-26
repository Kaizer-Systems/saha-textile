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
	/** Popup pictures in slide order; empty when there are none or the popup is off. */
	popupImages: ShopEventImage[];
	/** Which side of the text the pictures sit on, on computers. */
	popupImageSide: 'right' | 'left';
}

export interface ShopEventsResponse {
	serverNow: string;
	items: ShopEvent[];
}
