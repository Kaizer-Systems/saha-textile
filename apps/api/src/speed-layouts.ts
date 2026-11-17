import 'dotenv/config';
import 'reflect-metadata';

import {
	MongoContentBlockRepository,
	MongoPageLayoutRepository,
	MongoSiteSettingsRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { PIECE_MAX_PICTURES, PageSection } from '@saha-textile/contracts';
import { HOME_TEMPLATES, type HomeTemplateKey, templateSections } from '@saha-textile/core-domain';

/**
 * The speed gate's layouts (Page Builder SG-10): Home with each template, and a stress layout (every section type,
 * 15 sections, sliders of 10 pictures), each made live in turn on the e2e stack's database so Lighthouse measures what
 * shoppers would get from it.
 *
 *   node dist/speed-layouts.js list           the cases, one per line ("current" leaves Home as it is)
 *   node dist/speed-layouts.js live <case>    makes that case's layout live now (created once, then reused)
 *
 * Refuses any database but the e2e one, so it never changes a real shop.
 */
const SPEED_ACTOR = 'adm_speed_gate';
const STRESS_SECTIONS = 15;

type Case = 'current' | HomeTemplateKey | 'stress';
const CASES: readonly Case[] = ['current', ...HOME_TEMPLATES.map((template) => template.key), 'stress'];

const [command, name] = process.argv.slice(2);
if (command === 'list') {
	process.stdout.write(`${CASES.join('\n')}\n`);
	process.exit(0);
}
if (command !== 'live' || !CASES.includes(name as Case)) {
	process.stderr.write(`Usage: speed-layouts.js list | live <${CASES.join('|')}>\n`);
	process.exit(2);
}
const database = process.env['MONGODB_DB_NAME'] ?? '';
if (!/_e2e$/.test(database)) throw new Error(`Refused: MONGODB_DB_NAME=${database} is not the e2e database.`);

/** Every section type at least once, 15 sections in all, every banner piece sliding through 10 pictures. */
export function stressSections(base: readonly PageSection[]): PageSection[] {
	const pictures = base.flatMap((section) =>
		'pieces' in section ? section.pieces.flatMap((piece) => piece.pictures) : [],
	);
	const fill = <T>(list: readonly T[], size: number): T[] =>
		list.length ? Array.from({ length: size }, (_, index) => list[index % list.length] as T) : [];
	const widened = base.map((section) =>
		'pieces' in section
			? {
					...section,
					pieces: section.pieces.map((piece) => ({ ...piece, pictures: fill(pictures, PIECE_MAX_PICTURES) })),
				}
			: section,
	);
	const extras = (['recently_viewed', 'youtube_videos', 'blog_posts', 'newsletter'] as const)
		.filter((type) => !widened.some((section) => section.type === type))
		.map((type) => PageSection.parse({ id: `stress_${type}`, type, title: { en: 'Stress', bn: 'পরীক্ষা' } }));
	const sections = [...widened, ...extras];
	for (let index = 0; sections.length < STRESS_SECTIONS; index += 1) {
		sections.push(
			PageSection.parse({
				id: `stress_row_${index}`,
				type: 'product_row',
				title: { en: `Row ${index + 1}`, bn: `সারি ${index + 1}` },
			}),
		);
	}
	return sections.slice(0, Math.max(STRESS_SECTIONS, sections.length));
}

async function main(which: Case): Promise<void> {
	await connectMongo();
	try {
		const layouts = new MongoPageLayoutRepository();
		const now = new Date().toISOString();
		if (which === 'current') {
			// The page as seeded: no builder layout drawn.
			await layouts.setSchedule('home', 'page', [], now);
			process.stdout.write('Home: as seeded\n');
			return;
		}
		const [banners, home] = await Promise.all([
			new MongoContentBlockRepository().list({ ownerType: 'home', status: 'active' }),
			new MongoSiteSettingsRepository().get('storefront.home'),
		]);
		const context = { banners, heroLayout: home?.heroLayout ?? ('hero_full' as const), bringPictures: true };
		const sections =
			which === 'stress' ? stressSections(templateSections('today', context)) : templateSections(which, context);
		const layoutId = `lay_speed_${which}`;
		const existing = await layouts.layout(layoutId);
		if (!existing) {
			await layouts.createLayout({
				id: layoutId,
				pageType: 'home',
				target: 'page',
				name: `Speed gate · ${which}`,
				template: which === 'stress' ? null : which,
				draftRevisionId: null,
				lastLiveRevisionId: null,
				createdAt: now,
				updatedAt: now,
				updatedBy: SPEED_ACTOR,
				reviewRequest: null,
			});
		}
		const revision = await layouts.saveDraft({
			layoutId,
			sections,
			expectedDraftId: existing?.draftRevisionId ?? null,
			by: SPEED_ACTOR,
			at: now,
		});
		if (!revision) throw new Error(`Could not save the ${which} layout`);
		const revisionId = revision.id;
		// A live entry made by a person draws the builder (drawsBuilder), so the switch is left alone.
		await layouts.goLive({
			pageType: 'home',
			target: 'page',
			entry: { revisionId, layoutId, from: now, until: null, by: SPEED_ACTOR },
			at: now,
		});
		process.stdout.write(`Home: ${which} (${sections.length} sections) is live\n`);
	} finally {
		await disconnectMongo();
	}
}

void main(name as Case).catch((error: unknown) => {
	process.stderr.write(`${String(error)}\n`);
	process.exit(1);
});
