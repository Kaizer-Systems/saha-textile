import type { AccountsTemplate, TemplateInstall } from '@saha-textile/contracts';

/** The accounts templates library (accounts templates T2): every template with its dated versions. */
export interface AccountsTemplateRepository {
	list(): Promise<AccountsTemplate[]>;
	findByCode(code: string): Promise<AccountsTemplate | null>;
	/** Refused with `duplicate_template_code` when the code is taken. */
	insert(template: AccountsTemplate): Promise<void>;
	/** Refused with `template_changed` when someone saved it since `expectedUpdatedAt`. */
	save(template: AccountsTemplate, expectedUpdatedAt: string): Promise<void>;
}

/** Which version of each template this company's books were installed from (one row per template code). */
export interface TemplateInstallRepository {
	list(): Promise<TemplateInstall[]>;
	save(install: TemplateInstall): Promise<void>;
}
