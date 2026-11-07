import type { SiteSettingKey, SiteSettingValue } from '@saha-textile/contracts';

/** Typed site settings (`siteSettings`): one document per key, validated by the key's schema. */
export interface SiteSettingsRepository {
	/** The stored value, or null when the key has never been written. */
	get<K extends SiteSettingKey>(key: K): Promise<SiteSettingValue<K> | null>;
	set<K extends SiteSettingKey>(key: K, value: SiteSettingValue<K>): Promise<void>;
}
