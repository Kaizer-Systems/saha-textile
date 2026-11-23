import type { AccountsTemplate, TemplateInstall } from '@saha-textile/contracts';
import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';

/** In-memory accounts template stores for tests (accounts templates T2). */
export function memoryTemplateStores(rows: AccountsTemplate[] = [], installed: TemplateInstall[] = []) {
	const templates = {
		rows,
		list: async () => [...rows].sort((a, b) => a.code.localeCompare(b.code)),
		findByCode: async (code: string) => rows.find((row) => row.code === code) ?? null,
		insert: async (template: AccountsTemplate) => {
			if (rows.some((row) => row.code === template.code)) throw new Error('duplicate_template_code');
			rows.push(template);
		},
		save: async () => undefined,
	};
	const installs = {
		rows: installed,
		list: async () => [...installed],
		save: async (install: TemplateInstall) => {
			const at = installed.findIndex((row) => row.code === install.code);
			if (at >= 0) installed.splice(at, 1, install);
			else installed.push(install);
		},
	};
	return { templates, installs };
}

/** A real templates service over in-memory stores, for the kind of business a test gives. */
export function templatesFor(company: { getProfile: () => Promise<{ kind: string } | null> }) {
	const stores = memoryTemplateStores();
	return { ...stores, service: new AccountsTemplatesService(stores.templates, stores.installs, company as never) };
}
