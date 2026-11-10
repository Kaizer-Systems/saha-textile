/** The apps the product share menu can list (contracts `ShareApp`). Link and More are always there. */
export type ShareApp = 'whatsapp' | 'instagram' | 'facebook' | 'telegram' | 'email' | 'x' | 'linkedin' | 'pinterest';

/** `GET /catalog/share-settings`: Storefront settings › Sharing (contracts `StorefrontShareSettings`). */
export interface IShareSettings {
	/** The shop's X account, without the @. Empty for none. */
	xHandle: string;
	/** Hashtags from the product's facts on X posts. */
	hashtags: boolean;
	apps: ShareApp[];
}
