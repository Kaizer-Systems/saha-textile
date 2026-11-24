import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AccountsTemplate,
	BusinessKind,
	ChartTemplateContent,
	RcmChoice,
	TemplateChanges,
	TemplateContent,
	TemplateDraftWrite,
	TemplateKind,
	TemplateNew,
	TemplatePublish,
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
	chartChanges,
	ruleSetChanges,
	publishDraft,
	publishProblems,
	published,
} from '@saha-textile/core-domain';

import { ACCOUNTS_TEMPLATE_REPOSITORY, COMPANY_REPOSITORY, TEMPLATE_INSTALL_REPOSITORY } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';

/** What a new template of each type starts as, when it doesn't start from another. */
const EMPTY: Record<TemplateKind, TemplateContent> = {
	chart: { kind: 'chart', groups: [], ledgers: [] },
	taxRules: { kind: 'taxRules', list: 'reverseCharge', entries: [] },
	report: { kind: 'report', columns: 'thisAndLast', notes: false, level: null, lines: [] },
};

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
		return templates.map(({ versions, draft, ...template }) => {
			// A template made in the builder has no version until it is published.
			const newest = versions.length ? latestVersion({ versions }) : null;
			const installedVersion = installed.get(template.code) ?? null;
			return {
				...template,
				latestVersion: newest?.version ?? null,
				validFrom: newest?.validFrom ?? null,
				caReview: newest?.caReview ?? null,
				hasDraft: draft !== null,
				...lockState(template, kind),
				installedVersion,
				updateAvailable: (newest?.version ?? 0) > (installedVersion ?? Number.POSITIVE_INFINITY),
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
		for (const template of published(unlockedFor(templates, kind)).filter((t) => !have.has(t.code)))
			await this.installs.save({
				code: template.code,
				version: latestVersion(template).version,
				installedAt,
				installedBy: by,
			});
	}

	/** AT7 Install: the company now uses this version of the template (what it adds to the books is done before). */
	async markInstalled(code: string, version: number, by: string | null, now = new Date()): Promise<void> {
		await this.installs.save({ code, version, installedAt: now.toISOString(), installedBy: by });
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
		const charts = published(unlockedFor(await this.templates.list(), kind))
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

	/** A save refused because someone saved since: said in words. */
	private async saveOrConflict(template: AccountsTemplate, expectedUpdatedAt: string): Promise<AccountsTemplate> {
		try {
			await this.templates.save(template, expectedUpdatedAt);
		} catch (error) {
			if ((error as Error).message === 'template_changed')
				throw new ConflictException(accountsRefusal('template_changed'));
			throw error;
		}
		return template;
	}

	private async insertOrConflict(template: AccountsTemplate): Promise<AccountsTemplate> {
		try {
			await this.templates.insert(template);
		} catch (error) {
			if ((error as Error).message === 'duplicate_template_code')
				throw new ConflictException(accountsRefusal('duplicate_template_code'));
			throw error;
		}
		return template;
	}

	/** AT2 New template: a draft only (nothing uses it until it is published), empty or from another's newest version. */
	async create(write: TemplateNew, by: string | null, now = new Date()): Promise<AccountsTemplate> {
		await this.ensureLibrary();
		// A tax rule set's list is chosen here (AT5-D1).
		let content =
			write.kind === 'taxRules'
				? { kind: 'taxRules' as const, list: write.list, entries: [] }
				: EMPTY[write.kind];
		if (write.startFrom) {
			const from = await this.get(write.startFrom);
			if (from.kind !== write.kind || !from.versions.length)
				throw new BadRequestException(accountsRefusal('template_start_not_usable'));
			content = latestVersion(from).content;
		}
		const at = now.toISOString();
		return this.insertOrConflict({
			id: `tpl_${write.code.toLowerCase().replace(/-/g, '_')}`,
			code: write.code,
			kind: write.kind,
			name: write.name,
			description: write.description,
			appliesTo: write.appliesTo,
			versions: [],
			draft: { content, validFrom: istDay(now), source: '', notes: '', savedAt: at, savedBy: by },
			createdAt: at,
			updatedAt: at,
		});
	}

	/** AT3 Save draft. */
	async saveDraft(code: string, write: TemplateDraftWrite, by: string | null, now = new Date()) {
		const template = await this.get(code);
		const at = now.toISOString();
		return this.saveOrConflict(
			{
				...template,
				draft: {
					content: write.content,
					validFrom: write.validFrom,
					source: write.source,
					notes: write.notes,
					savedAt: at,
					savedBy: by,
				},
				updatedAt: at,
			},
			write.expectedUpdatedAt,
		);
	}

	/**
	 * AT3 "Changes from vN" and AT5 "Compare with vN": what the draft changes against the newest version, for a chart or a
	 * tax rule set (a report's comes with its builder).
	 */
	async changes(code: string): Promise<TemplateChanges | null> {
		const template = await this.get(code);
		const draft = template.draft?.content;
		const latest = template.versions.length ? latestVersion(template).content : null;
		if (draft?.kind === 'chart') return chartChanges(latest?.kind === 'chart' ? latest : null, draft);
		if (draft?.kind === 'taxRules') return ruleSetChanges(latest?.kind === 'taxRules' ? latest : null, draft);
		return null;
	}

	/** AT3 Publish vN: every publishing check passes, then the draft becomes the next version (CA review pending). */
	async publish(code: string, write: TemplatePublish, by: string | null, now = new Date()) {
		const template = await this.get(code);
		const problems = publishProblems(template, await this.templates.list());
		if (problems.length)
			throw new BadRequestException({
				message: String(problems[0]),
				issues: problems.map((problem) => ({ path: 'draft', code: problem, message: problem })),
			});
		return this.saveOrConflict(publishDraft(template, by, now.toISOString()), write.expectedUpdatedAt);
	}

	/** AT4 "From template": each installed chart template, as "CH-COMMON v2", with the keys it holds. */
	async installedCharts(): Promise<{ label: string; keys: ReadonlySet<string> }[]> {
		await this.ensureLibrary();
		const [templates, installs] = await Promise.all([this.templates.list(), this.installs.list()]);
		return installs.flatMap((install) => {
			const version = templates
				.find((t) => t.code === install.code)
				?.versions.find((v) => v.version === install.version);
			if (version?.content.kind !== 'chart') return [];
			const items = [...version.content.groups, ...version.content.ledgers];
			return [{ label: `${install.code} v${install.version}`, keys: new Set(items.map((item) => item.key)) }];
		});
	}

	/** AT2 Import: a template saved from another deployment keeps its code and versions; a code taken here is refused. */
	async importTemplate(template: AccountsTemplate, now = new Date()): Promise<AccountsTemplate> {
		await this.ensureLibrary();
		const at = now.toISOString();
		return this.insertOrConflict({
			...template,
			id: `tpl_${template.code.toLowerCase().replace(/-/g, '_')}`,
			createdAt: at,
			updatedAt: at,
		});
	}
}
