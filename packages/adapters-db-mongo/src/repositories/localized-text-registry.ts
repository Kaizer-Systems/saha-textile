import type { WrittenLanguageArea } from '@saha-textile/contracts';
import { registeredPageTypes } from '@saha-textile/core-domain';
import type { Model, mongo } from 'mongoose';

import {
	AddonTemplateModel,
	BuilderPageModel,
	AttributeDefinitionModel,
	BlogCategoryModel,
	BundlePriceMethodModel,
	ProductBundleModel,
	BlogPostModel,
	BlogTagModel,
	CategoryModel,
	ContentBlockModel,
	FaqEntryModel,
	LegalPageModel,
	MediaAssetModel,
	NotificationTemplateModel,
	ProductModel,
	SearchTermModel,
	ShopEventModel,
	StoreLocationModel,
} from '../models/index';

/**
 * Every stored text that is written once per language, in one list (step 0d, Settings › Languages).
 *
 * The same list answers three questions, so they can never disagree: what is still empty in a
 * language among the things the shop shows (the to-do counts and each list page's "missing"
 * filter), which items hold any text in it (shown before delete and erase), and what erase must
 * remove. The rules mirror each form's Language switch and each Go Live check: a `required` field
 * needs every language; a `follows_english` field may stay empty, and needs other languages only
 * once its English is written. Rich-editor fields count as empty when they hold only tags.
 *
 * Like the media owner registry, a schema-walking test (`test/localized-text-registry.test.ts`)
 * fails when a model gains a free-form field that is neither listed here nor named as not text.
 */
export type TextRule = 'required' | 'follows_english';

export interface TextField {
	/**
	 * Dotted path to a `{ en, bn, … }` object. `$[]` steps into every element of an array:
	 * `optionGroups.$[].terms.$[].label`.
	 */
	path: string;
	rule: TextRule;
	/** Rich-editor HTML: only text outside tags counts. */
	html?: boolean;
	/** Kept for erase only: an older shape no form writes any more, so it can never be a to-do. */
	eraseOnly?: boolean;
}

export interface LocalizedTextEntry {
	owner: string;
	model: Model<never>;
	/** The to-do line it counts in; null for text the shop never waits on (messages). */
	area: WrittenLanguageArea | null;
	/** What the shop shows. Only these count as to-dos; erase reaches every item. */
	live: Record<string, unknown>;
	fields: readonly TextField[];
	/** Objects keyed by language whose `<code>` entry is that language's data (erase only). */
	keyedByLanguage?: readonly string[];
	/** The field the admin's list knows an item by, when it is not `_id`. */
	idField?: string;
}

const as = <T>(model: Model<T>): Model<never> => model as unknown as Model<never>;

/** Page types whose main heading comes from Page settings (Home today), from core's registry. */
const PAGE_SETTINGS_TYPES = registeredPageTypes()
	.filter((rules) => rules.mainHeading === 'page_settings')
	.map((rules) => rules.key);
const required = (path: string, html = false): TextField => ({ path, rule: 'required', ...(html ? { html } : {}) });
const followsEnglish = (path: string, html = false): TextField => ({
	path,
	rule: 'follows_english',
	...(html ? { html } : {}),
});
const olderShape = (path: string): TextField => ({ path, rule: 'follows_english', eraseOnly: true });

export const LOCALIZED_TEXT_REGISTRY: readonly LocalizedTextEntry[] = [
	{
		// The product form's Language switch and Go Live: title, both descriptions, search text,
		// every option and value name; the delivery line once English has one.
		owner: 'products',
		model: as(ProductModel),
		area: 'products',
		live: { status: 'live' },
		fields: [
			required('title'),
			required('shortDescription'),
			required('description'),
			required('seo.title'),
			required('seo.description'),
			required('optionGroups.$[].label'),
			required('optionGroups.$[].terms.$[].label'),
			// Quick-length buttons of fabric sold by the metre (shop brief A01, M5).
			required('quickLengths.$[].label'),
			followsEnglish('estimatedDeliveryText'),
			// Older shapes the product form does not write: erase reaches them; they are never to-dos.
			olderShape('attributes.$[].label'),
			olderShape('attributes.$[].terms.$[].label'),
			olderShape('addons.$[].label'),
		],
	},
	{
		// A bundle's level names show on the shop's set rows (bundle builder brief, approved 2026-11-22). They count
		// on the products line, against the bundle's product.
		owner: 'bundles',
		model: as(ProductBundleModel),
		area: 'products',
		live: { status: 'live' },
		idField: 'productId',
		fields: [required('levels.$[].label')],
	},
	{
		// The "Set price is" list: admin's own words, never a shop to-do; erase still reaches them.
		owner: 'bundle price methods',
		model: as(BundlePriceMethodModel),
		area: null,
		live: {},
		idField: 'code',
		fields: [required('name'), required('help'), required('inputs.$[].label')],
	},
	{
		owner: 'options',
		model: as(AttributeDefinitionModel),
		area: 'options',
		live: {},
		idField: 'code',
		fields: [required('label'), required('terms.$[].label'), followsEnglish('filterConfig.defaultFacetLabel')],
	},
	{
		owner: 'categories',
		model: as(CategoryModel),
		area: 'categories',
		live: {},
		fields: [required('name'), required('description'), required('seo.title'), required('seo.description')],
	},
	{
		// Alt text in every language; a title or caption once English has one.
		owner: 'photos',
		model: as(MediaAssetModel),
		area: 'photos',
		live: { deletedAt: null },
		fields: [required('text.alt'), followsEnglish('text.title'), followsEnglish('text.caption')],
	},
	{
		owner: 'banners',
		model: as(ContentBlockModel),
		area: 'banners',
		live: { status: 'active' },
		fields: [required('alt'), followsEnglish('heading'), followsEnglish('subheading'), followsEnglish('ctaLabel')],
		keyedByLanguage: ['localeImages'],
	},
	{
		owner: 'blog posts',
		model: as(BlogPostModel),
		area: 'blog_posts',
		live: { status: 'live' },
		fields: [
			required('title'),
			required('content', true),
			followsEnglish('excerpt'),
			followsEnglish('author'),
			followsEnglish('seoTitle'),
			followsEnglish('seoDescription'),
		],
	},
	{
		owner: 'blog categories',
		model: as(BlogCategoryModel),
		area: 'blog_categories',
		live: { status: 'live' },
		fields: [required('name'), followsEnglish('description')],
	},
	{
		owner: 'blog tags',
		model: as(BlogTagModel),
		area: 'blog_tags',
		live: { status: 'live' },
		fields: [required('name'), followsEnglish('description')],
	},
	{
		// Published launches and sales the shop still shows or will show.
		owner: 'events',
		model: as(ShopEventModel),
		area: 'events',
		live: { status: { $in: ['scheduled', 'live'] } },
		fields: [required('title'), required('message', true)],
	},
	{
		owner: 'stores',
		model: as(StoreLocationModel),
		area: 'stores',
		live: { active: true },
		fields: [required('name'), required('address'), followsEnglish('landmark')],
	},
	{
		owner: 'FAQs',
		model: as(FaqEntryModel),
		area: 'faqs',
		live: { status: 'live' },
		fields: [required('question'), required('answer', true)],
	},
	{
		owner: 'search words',
		model: as(SearchTermModel),
		area: 'search_words',
		live: { status: 'live' },
		fields: [required('name')],
		keyedByLanguage: ['spellings'],
	},
	{
		owner: 'add-on templates',
		model: as(AddonTemplateModel),
		area: 'addon_templates',
		live: {},
		idField: 'code',
		fields: [required('label'), required('fields.$[].label')],
	},
	{
		// The four legal pages (Legal Pages brief): always on the shop, so Title and Content are needed in every
		// language; the search title and description follow English.
		owner: 'page builder pages',
		model: as(BuilderPageModel),
		// A page's own search title, description and main heading (Page Builder P3). Only page types whose one H1
		// comes from Page settings; layout words are counted beside this (language-coverage.repository.ts).
		area: 'page_builder',
		live: { pageType: { $in: PAGE_SETTINGS_TYPES } },
		fields: [required('settings.title'), required('settings.description'), required('settings.heading')],
	},
	{
		owner: 'legal pages',
		model: as(LegalPageModel),
		// Settings › Languages counts them from the database (Legal Pages brief).
		area: 'pages',
		live: {},
		fields: [
			required('title'),
			required('content', true),
			followsEnglish('metaTitle'),
			followsEnglish('metaDescription'),
		],
	},
	{
		// Email wording per language. Messages fall back to English and never block a language.
		owner: 'message templates',
		model: as(NotificationTemplateModel),
		area: null,
		live: {},
		fields: [followsEnglish('emailSubject'), followsEnglish('emailBody', true)],
	},
];

/** Text in a field: anything but spaces. */
const HAS_TEXT = /\S/;
/** Text in rich-editor HTML: a character outside the tags. */
const HAS_HTML_TEXT = /(?:^|>)[^<]*[^\s<]/;

type Condition = Record<string, unknown>;
/**
 * A filter for the driver's collection. The registry queries the collection directly: its paths
 * reach inside free-form fields Mongoose's schema types know nothing about.
 */
export type TextFilter = mongo.Filter<mongo.Document>;
const asFilter = (condition: Condition): TextFilter => condition as TextFilter;

/** The condition "this field has no text in `code`", relative to the document or an array element. */
function emptyIn(field: TextField, code: string): Condition {
	const steps = field.path.split('.$[].');
	const leaf = steps.pop() as string;
	const text = field.html ? HAS_HTML_TEXT : HAS_TEXT;
	let condition: Condition =
		field.rule === 'required'
			? { [`${leaf}.${code}`]: { $not: text } }
			: { $and: [{ [`${leaf}.en`]: text }, { [`${leaf}.${code}`]: { $not: text } }] };
	for (const array of steps.reverse()) condition = { [array]: { $elemMatch: condition } };
	return condition;
}

/** The condition "this item holds some text in `code`". */
function holdsIn(field: TextField, code: string): Condition {
	const steps = field.path.split('.$[].');
	const leaf = steps.pop() as string;
	let condition: Condition = { [`${leaf}.${code}`]: HAS_TEXT };
	for (const array of steps.reverse()) condition = { [array]: { $elemMatch: condition } };
	return condition;
}

/** Items of one entry the shop shows whose text in `code` is incomplete. */
export function missingTextFilter(entry: LocalizedTextEntry, code: string, extra: Condition = {}): TextFilter {
	const counted = entry.fields.filter((field) => !field.eraseOnly);
	return asFilter({ $and: [entry.live, extra, { $or: counted.map((field) => emptyIn(field, code)) }] });
}

/** Items of one entry holding any text in `code`, live or not. */
export function heldTextFilter(entry: LocalizedTextEntry, code: string): TextFilter {
	return asFilter({
		$or: [
			...entry.fields.map((field) => holdsIn(field, code)),
			...(entry.keyedByLanguage ?? []).map((path) => ({ [`${path}.${code}`]: { $exists: true } })),
		],
	});
}

/** The `$unset` that removes `code` from every field of an entry (array steps reach every element). */
export function eraseUpdate(entry: LocalizedTextEntry, code: string): Record<string, ''> {
	return Object.fromEntries([
		...entry.fields.map((field) => [`${field.path}.${code}`, ''] as const),
		...(entry.keyedByLanguage ?? []).map((path) => [`${path}.${code}`, ''] as const),
	]);
}

/** The entries counted in one to-do area. */
export const entriesFor = (area: WrittenLanguageArea): LocalizedTextEntry[] =>
	LOCALIZED_TEXT_REGISTRY.filter((entry) => entry.area === area);
