import { MongoCurrencyRepository, MongoNotificationTemplateRepository } from '../repositories/index';
import { seedCurrencies } from './data';
import { CATALOG_NOTIFICATION_TEMPLATES } from './notification-templates';
import { ensureSystemRoles } from './system-roles';

export interface FirstRunResult {
	currencies: number;
	templates: number;
}

/**
 * The rows a new deployed database cannot work without: the administrator role, the currencies
 * and the catalogue's notification templates. Nothing else. Products, categories, customers and
 * promotions are entered in admin, and never come from a seed here.
 *
 * Adds only what is missing, so running it again leaves anything staff have changed alone.
 */
export async function seedFirstRun(): Promise<FirstRunResult> {
	await ensureSystemRoles();
	const currencies = new MongoCurrencyRepository();
	const templates = new MongoNotificationTemplateRepository();
	const result: FirstRunResult = { currencies: 0, templates: 0 };

	for (const currency of seedCurrencies) {
		if (await currencies.findByCode(currency.code)) continue;
		await currencies.upsert(currency);
		result.currencies += 1;
	}
	for (const template of CATALOG_NOTIFICATION_TEMPLATES) {
		if (await templates.findByKey(template.key)) continue;
		await templates.upsert(template);
		result.templates += 1;
	}
	return result;
}
