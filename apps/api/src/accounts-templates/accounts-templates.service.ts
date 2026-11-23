import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	TemplateLibraryRow,
	TemplateVersion,
} from '@saha-textile/contracts';
import {
	type AccountsTemplateRepository,
	type CompanyRepository,
	latestVersion,
	lockState,
	mergeCharts,
	starterTemplates,
	type TemplateInstallRepository,
	unlockedFor,
} from '@saha-textile/core-domain';

import { ACCOUNTS_TEMPLATE_REPOSITORY, COMPANY_REPOSITORY, TEMPLATE_INSTALL_REPOSITORY } from '../infra/tokens';

/** A template and the version of it the books take. */
export interface TemplatePick {
	code: string;
	version: number;
}

type ChartVersion = TemplateVersion & { content: ChartTemplateContent };

/**
 * Accounts templates (owner-approved 2026-11-24, step T2): charts of accounts, tax rule sets and report layouts are data
 * with a reference code and dated versions, unlocked by the kind of company. The library starts from the starter
 * templates (AT-D1) and the company's books are installed from the shared templates plus its kind's own.
 */
@Injectable()
export class AccountsTemplatesService {
	private seeding: Promise<void> | null = null;

	constructor(
		@Inject(ACCOUNTS_TEMPLATE_REPOSITORY) private readonly templates: AccountsTemplateRepository,
		@Inject(TEMPLATE_INSTALL_REPOSITORY) private readonly installs: TemplateInstallRepository,
		@Inject(COMPANY_REPOSITORY) private readonly company: Pick<CompanyRepository, 'getProfile'>,
	) {}

	/** The starter templates are written once, into an empty library; after that the library is the builder's. */
	private ensureLibrary(): Promise<void> {
		this.seeding ??= (async () => {
			if ((await this.templates.list()).length) return;
			for (const template of starterTemplates(new Date().toISOString()))
				await this.templates.insert(template).catch((error: unknown) => {
					// Another API instance wrote it first: theirs stands.
					if ((error as Error).message !== 'duplicate_template_code') throw error;
				});
		})().catch((error: unknown) => {
			this.seeding = null;
			throw error;
		});
		return this.seeding;
	}

	/** The kind of business on Settings › Company (proprietorship until it is set). */
	private async kind(): Promise<BusinessKind> {
		return (await this.company.getProfile())?.kind ?? 'proprietorship';
	}

	/** Settings › Accounts templates (AT2): every template; another kind's stay listed, locked, with the reason (AT-D2). */
	async library(): Promise<TemplateLibraryRow[]> {
		await this.ensureLibrary();
		const [templates, installs, kind] = await Promise.all([
			this.templates.list(),
			this.installs.list(),
			this.kind(),
		]);
		const installed = new Map(installs.map((install) => [install.code, install.version]));
		return templates.map(({ versions, ...template }) => {
			const latest = latestVersion({ versions }).version;
			const installedVersion = installed.get(template.code) ?? null;
			return {
				...template,
				latestVersion: latest,
				...lockState(template, kind),
				installedVersion,
				updateAvailable: installedVersion !== null && latest > installedVersion,
			};
		});
	}

	/** One template with every version, by its reference code. */
	async get(code: string): Promise<AccountsTemplate> {
		await this.ensureLibrary();
		const template = await this.templates.findByCode(code);
		if (!template) throw new NotFoundException('template_not_found');
		return template;
	}

	/** The chart a company's books start from: the shared chart templates and its own kind's, newest versions (AT1). */
	async startingChart(): Promise<{ chart: ReturnType<typeof mergeCharts>; picks: TemplatePick[] }> {
		await this.ensureLibrary();
		const kind = await this.kind();
		const charts = unlockedFor(await this.templates.list(), kind)
			.map((template) => ({ code: template.code, version: latestVersion(template) }))
			.filter((pick): pick is { code: string; version: ChartVersion } => pick.version.content.kind === 'chart');
		return {
			chart: mergeCharts(charts.map((pick) => pick.version.content)),
			picks: charts.map((pick) => ({ code: pick.code, version: pick.version.version })),
		};
	}

	/**
	 * Records what the books were installed from, once. Books seeded before templates existed are recorded as installed
	 * from the templates that hold the same chart, so nothing is seeded again.
	 */
	async recordInstalls(picks: readonly TemplatePick[]): Promise<void> {
		if ((await this.installs.list()).length) return;
		const installedAt = new Date().toISOString();
		for (const pick of picks) await this.installs.save({ ...pick, installedAt, installedBy: null });
	}
}
