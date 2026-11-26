import type { ResolvedImage } from '@core/media/resolved-image';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** One day of `StoreHours` from `@saha-textile/contracts`. */
export interface StoreDayHours {
	day: Weekday;
	open: boolean;
	opens: string | null;
	closes: string | null;
}

/**
 * `PublicStoreLocation` from `@saha-textile/contracts`, as Contact Us reads it: one store in the
 * page language, hours already grouped into `hoursSummary`, photos with their store sizes.
 */
export interface PublicStoreLocation {
	id: string;
	name: string;
	address: string;
	landmark: string | null;
	pinCode: string;
	mapUrl: string;
	phone: string | null;
	phoneDisplay: string | null;
	hoursSummary: string;
	hours: StoreDayHours[];
	geo: { lat: number; lng: number } | null;
	photos: (ResolvedImage & { assetId: string })[];
}
