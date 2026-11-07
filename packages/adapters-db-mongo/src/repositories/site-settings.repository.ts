import { SITE_SETTING_SCHEMAS, type SiteSettingKey, type SiteSettingValue } from '@saha-textile/contracts';
import type { SiteSettingsRepository } from '@saha-textile/core-domain';

import { SiteSettingModel, type SiteSettingDoc } from '../models/index';

/**
 * Typed settings store. Values are validated by their key's schema on the way IN and on the
 * way OUT, so a document edited by hand in Compass cannot hand a reader a shape it does not
 * understand — an unparseable value reads as unset and the caller's default applies.
 */
export class MongoSiteSettingsRepository implements SiteSettingsRepository {
	async get<K extends SiteSettingKey>(key: K): Promise<SiteSettingValue<K> | null> {
		const doc = await SiteSettingModel.findById(key).lean<SiteSettingDoc>().exec();
		if (!doc) return null;
		const parsed = SITE_SETTING_SCHEMAS[key].safeParse(doc.value);
		return parsed.success ? (parsed.data as SiteSettingValue<K>) : null;
	}

	async set<K extends SiteSettingKey>(key: K, value: SiteSettingValue<K>): Promise<void> {
		const parsed = SITE_SETTING_SCHEMAS[key].parse(value);
		await SiteSettingModel.updateOne({ _id: key }, { $set: { value: parsed } }, { upsert: true }).exec();
	}
}
