import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	RcmChoice,
	TemplatesOpen,
	TaxRuleSetContent,
	TemplateLibraryRow,
	TemplateVersion,
} from '@saha-textile/contracts';
import {
	type AccountsTemplateRepository,
	type CompanyRepository,
	latestVersion,
	lockState,
	mergeCharts,
	starterChanges,
	starterTemplates,
	type TemplateInstallRepository,
	unlockedFor,
	entriesOn,
	istDay,
	versionOn,
	whatOpens,
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

	/**
	 * The shipped starter templates reach the library once each: a template it lacks is added, and a newer starter
	 * version of a template no person has published is added as an update (installed only by a person, AT-D5).
	 */
	private ensureLibrary(): Promise<void> {
		this.seeding ??= (async () => {
			const { inserts, updates } = starterChanges(
				await this.templates.list(),
				starterTemplates(new Date().toISOString()),
			);
			// Another API instance may write the same first: theirs stands.
			const theirs = (code: string) => (error: unknown) => {
				if ((error as Error).message !== code) throw error;
			};
			for (const template of inserts)
				await this.templates.insert(template).catch(theirs('duplicate_template_code'));
			for (const update of updates)
				await this.templates.save(update.template, update.expectedUpdatedAt).catch(theirs('template_changed'));
		})().catch((error: unknown) => {
			this.seeding = null;
			throw error;
		});
		return this.seeding;
	}

	/** The kind of business on Settings › Company (proprietorship until it is set). */
	async kind(): Promise<BusinessKind> {
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
			const newest = latestVersion({ versions });
			const latest = newest.version;
			const installedVersion = installed.get(template.code) ?? null;
			return {
				...template,
				latestVersion: latest,
				validFrom: newest.validFrom,
				caReview: newest.caReview,
				...lockState(template, kind),
				installedVersion,
				updateAvailable: installedVersion !== null && latest > installedVersion,
			};
		});
	}

	/** Whether the company's books are installed (any template recorded as installed). */
	async booksSetUp(): Promise<boolean> {
		return (await this.installs.list()).length > 0;
	}

	/** AT1 "What opens" for a kind of company, and whether the books are already set up. */
	async opens(kind: BusinessKind, now = new Date()): Promise<TemplatesOpen> {
		await this.ensureLibrary();
		const [templates, booksSetUp] = await Promise.all([this.templates.list(), this.booksSetUp()]);
		return { ...whatOpens(templates, kind, istDay(now)), booksSetUp };
	}

	/** T3: every template the kind unlocks is recorded as installed at its newest version; installed ones keep theirs. */
	async installUnlocked(by: string | null): Promise<void> {
		await this.ensureLibrary();
		const [templates, installs, kind] = await Promise.all([
			this.templates.list(),
			this.installs.list(),
			this.kind(),
		]);
		const have = new Set(installs.map((install) => install.code));
		const installedAt = new Date().toISOString();
		for (const template of unlockedFor(templates, kind).filter((t) => !have.has(t.code)))
			await this.installs.save({
				code: template.code,
				version: latestVersion(template).version,
				installedAt,
				installedBy: by,
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

	/**
	 * The version of a template the company uses: the one installed, or, on first use, the newest (recorded as
	 * installed). Later versions wait for a person to install them.
	 */
	private async installedVersion(template: AccountsTemplate): Promise<number> {
		const install = (await this.installs.list()).find((row) => row.code === template.code);
		if (install) return install.version;
		const version = latestVersion(template).version;
		await this.installs.save({
			code: template.code,
			version,
			installedAt: new Date().toISOString(),
			installedBy: null,
		});
		return version;
	}

	/**
	 * D2's "What": the reverse-charge list (RS-RCM) in force on the day the supply was received, for this company's
	 * kind. Each choice names the rule set and version it came from, so a self-invoice keeps the rule it was made with.
	 */
	async rcmChoices(day: string): Promise<RcmChoice[]> {
		await this.ensureLibrary();
		const template = await this.templates.findByCode('RS-RCM');
		if (!template) return [];
		const installed = await this.installedVersion(template);
		const version = versionOn({ versions: template.versions.filter((v) => v.version <= installed) }, day);
		if (version?.content.kind !== 'taxRules') return [];
		const kind = await this.kind();
		return entriesOn((version.content as TaxRuleSetContent).entries, kind, day).flatMap((entry) =>
			entry.expenseRole
				? [
						{
							templateCode: template.code,
							templateVersion: version.version,
							key: entry.key,
							name: entry.name,
							code: entry.code,
							ratePercent: entry.ratePercent,
							expenseRole: entry.expenseRole,
							source: entry.source,
						},
					]
				: [],
		);
	}
}
