import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type Schema, type SchemaType } from 'mongoose';

import {
	AdminInviteModel,
	AttributeDefinitionModel,
	AuditLogModel,
	AuthRateLimitModel,
	AuthSessionModel,
	CartModel,
	CategoryFacetConfigModel,
	CategoryModel,
	CategoryPlacementModel,
	ConsentEventModel,
	CurrencyModel,
	EmailVerificationTokenModel,
	FaqEntryModel,
	InventoryCostLayerModel,
	InventoryLedgerModel,
	MediaAssetModel,
	MessageOutboxModel,
	NotificationChannelSettingsModel,
	NotificationTemplateModel,
	OAuthStateModel,
	OtpChallengeModel,
	OrderModel,
	PasswordResetTokenModel,
	ProductBundleModel,
	ProductModel,
	ProductQuestionModel,
	ProductRelationModel,
	ProductVariantModel,
	PromotionModel,
	RatingAggregateModel,
	ReviewModel,
	UserModel,
} from '../src/models/index';
import * as modelExports from '../src/models/index';

type CatalogueModel = {
	modelName: string;
	collection: { collectionName: string };
	schema: Schema;
};

const packageRoot = resolve(process.cwd());
const repositoryRoot = resolve(packageRoot, '../..');

const modelSources: Array<{
	model: CatalogueModel;
	source: string;
	context: string;
	purpose: string;
}> = [
	{
		model: CategoryModel,
		source: 'packages/adapters-db-mongo/src/models/category.model.ts',
		context: 'Catalogue',
		purpose: 'Current category hierarchy and presentation metadata.',
	},
	{
		model: ProductModel,
		source: 'packages/adapters-db-mongo/src/models/product.model.ts',
		context: 'Catalogue',
		purpose: 'Current product, price, merchandising, and variation scaffold.',
	},
	{
		model: PromotionModel,
		source: 'packages/adapters-db-mongo/src/models/promotion.model.ts',
		context: 'Commerce',
		purpose: 'Current promotion eligibility and coupon scaffold.',
	},
	{
		model: OrderModel,
		source: 'packages/adapters-db-mongo/src/models/order.model.ts',
		context: 'Orders',
		purpose: 'Current order totals, lifecycle, and payment-gateway scaffold.',
	},
	{
		model: CurrencyModel,
		source: 'packages/adapters-db-mongo/src/models/currency.model.ts',
		context: 'Currency',
		purpose: 'Current INR-derived currency and PayPal gross-up configuration.',
	},
	{
		model: CartModel,
		source: 'packages/adapters-db-mongo/src/models/cart.model.ts',
		context: 'Cart',
		purpose: 'Current guest or user cart and line scaffold.',
	},
	{
		model: UserModel,
		source: 'packages/adapters-db-mongo/src/models/user.model.ts',
		context: 'Identity',
		purpose: 'Current user identity, credentials, role, consent, and address scaffold.',
	},
	{
		model: AuthSessionModel,
		source: 'packages/adapters-db-mongo/src/models/auth-session.model.ts',
		context: 'Identity',
		purpose: 'Current rotating, session-bound refresh and CSRF persistence capability.',
	},
	{
		model: OtpChallengeModel,
		source: 'packages/adapters-db-mongo/src/models/auth-challenge.model.ts',
		context: 'Identity',
		purpose: 'Current hash-only, single-use OTP challenge persistence capability.',
	},
	{
		model: OAuthStateModel,
		source: 'packages/adapters-db-mongo/src/models/auth-challenge.model.ts',
		context: 'Identity',
		purpose: 'Current hash-only OAuth state, nonce, and PKCE persistence capability.',
	},
	{
		model: PasswordResetTokenModel,
		source: 'packages/adapters-db-mongo/src/models/auth-token.model.ts',
		context: 'Identity',
		purpose: 'Current hash-only, single-use password-reset token persistence capability.',
	},
	{
		model: EmailVerificationTokenModel,
		source: 'packages/adapters-db-mongo/src/models/auth-token.model.ts',
		context: 'Identity',
		purpose: 'Current hash-only, single-use email-verification token persistence capability.',
	},
	{
		model: AdminInviteModel,
		source: 'packages/adapters-db-mongo/src/models/auth-token.model.ts',
		context: 'Identity',
		purpose: 'Current hash-only admin-invite and acceptance-audit persistence capability.',
	},
	{
		model: AuthRateLimitModel,
		source: 'packages/adapters-db-mongo/src/models/auth-rate-limit.model.ts',
		context: 'Identity',
		purpose: 'Current atomic, TTL-expiring auth rate-limit counter capability.',
	},
	{
		model: ConsentEventModel,
		source: 'packages/adapters-db-mongo/src/models/consent.model.ts',
		context: 'Privacy',
		purpose: 'Append-only user and guest consent history.',
	},
	{
		model: CategoryPlacementModel,
		source: 'packages/adapters-db-mongo/src/models/catalog-structure.model.ts',
		context: 'Catalogue',
		purpose: 'Category placement paths, canonical placement, and visibility.',
	},
	{
		model: CategoryFacetConfigModel,
		source: 'packages/adapters-db-mongo/src/models/catalog-structure.model.ts',
		context: 'Catalogue',
		purpose: 'Category-scoped storefront facet configuration.',
	},
	{
		model: AttributeDefinitionModel,
		source: 'packages/adapters-db-mongo/src/models/catalog-structure.model.ts',
		context: 'Catalogue',
		purpose: 'Canonical attribute definitions and option display policy.',
	},
	{
		model: ProductVariantModel,
		source: 'packages/adapters-db-mongo/src/models/product-variant.model.ts',
		context: 'Catalogue',
		purpose: 'First-class SKU variants and purchasable option combinations.',
	},
	{
		model: ProductBundleModel,
		source: 'packages/adapters-db-mongo/src/models/merchandising.model.ts',
		context: 'Merchandising',
		purpose: 'Bundle components and nesting evidence.',
	},
	{
		model: ProductRelationModel,
		source: 'packages/adapters-db-mongo/src/models/merchandising.model.ts',
		context: 'Merchandising',
		purpose: 'Typed product relations and automatic visibility pausing.',
	},
	{
		model: MediaAssetModel,
		source: 'packages/adapters-db-mongo/src/models/media.model.ts',
		context: 'Media',
		purpose: 'Reference-counted media assets and soft-delete lifecycle.',
	},
	{
		model: InventoryLedgerModel,
		source: 'packages/adapters-db-mongo/src/models/inventory.model.ts',
		context: 'Inventory',
		purpose: 'Atomic stock movements and immutable quantity evidence.',
	},
	{
		model: InventoryCostLayerModel,
		source: 'packages/adapters-db-mongo/src/models/inventory.model.ts',
		context: 'Inventory',
		purpose: 'FIFO receipt, consume, and release cost layers.',
	},
	{
		model: AuditLogModel,
		source: 'packages/adapters-db-mongo/src/models/governance.model.ts',
		context: 'Governance',
		purpose: 'Append-only operational and security audit evidence.',
	},
	{
		model: NotificationChannelSettingsModel,
		source: 'packages/adapters-db-mongo/src/models/governance.model.ts',
		context: 'Notifications',
		purpose: 'Per-channel and category notification policy.',
	},
	{
		model: NotificationTemplateModel,
		source: 'packages/adapters-db-mongo/src/models/governance.model.ts',
		context: 'Notifications',
		purpose: 'Versioned transactional and marketing message templates.',
	},
	{
		model: MessageOutboxModel,
		source: 'packages/adapters-db-mongo/src/models/governance.model.ts',
		context: 'Notifications',
		purpose: 'Idempotent notification delivery outbox and recorded result.',
	},
	{
		model: FaqEntryModel,
		source: 'packages/adapters-db-mongo/src/models/content.model.ts',
		context: 'Content',
		purpose: 'Scoped FAQ entries for product and category resolution.',
	},
	{
		model: ProductQuestionModel,
		source: 'packages/adapters-db-mongo/src/models/content.model.ts',
		context: 'Content',
		purpose: 'Moderated product questions with private asker contact.',
	},
	{
		model: ReviewModel,
		source: 'packages/adapters-db-mongo/src/models/content.model.ts',
		context: 'Content',
		purpose: 'Verified-purchase product reviews and moderation state.',
	},
	{
		model: RatingAggregateModel,
		source: 'packages/adapters-db-mongo/src/models/content.model.ts',
		context: 'Content',
		purpose: 'Approved-review rating totals and distribution.',
	},
];

function readArgument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function printableDefault(value: unknown): unknown {
	if (typeof value === 'function') {
		return '<generated>';
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return value;
}

function enumValues(options: Record<string, unknown>): unknown[] {
	const values = options.enum;
	return Array.isArray(values) ? values.filter((value) => typeof value !== 'undefined') : [];
}

function arrayElementType(schemaType: SchemaType): string | undefined {
	const candidate = schemaType as SchemaType & { caster?: SchemaType };
	return candidate.caster?.instance;
}

function syntheticValue(path: string, type: string, values: unknown[], defaultValue: unknown): unknown {
	if (path === '_id') return '<document-id>';
	if (typeof defaultValue !== 'undefined' && defaultValue !== '<generated>') return defaultValue;
	if (values.length > 0) return values[0];
	switch (type) {
		case 'Array':
			return [];
		case 'Boolean':
			return false;
		case 'Date':
			return '2026-01-01T00:00:00.000Z';
		case 'Mixed':
			return '<shape pending>';
		case 'Number':
			return 0;
		default:
			return `<${path}>`;
	}
}

function compileModel(entry: (typeof modelSources)[number]) {
	const fields = Object.entries(entry.model.schema.paths)
		.filter(([path]) => path !== '__v')
		.map(([path, schemaType]) => {
			const options = schemaType.options as Record<string, unknown>;
			const values = enumValues(options);
			const defaultValue = printableDefault(options.default);
			const elementType = arrayElementType(schemaType);
			return {
				path,
				type: schemaType.instance,
				elementType,
				required: Boolean(options.required),
				select: options.select === false ? 'excluded-by-default' : 'included',
				default: defaultValue,
				enum: values,
				temporaryShape:
					schemaType.instance === 'Mixed' || (schemaType.instance === 'Array' && elementType === 'Mixed'),
				sensitive: options.select === false,
			};
		});

	const example = Object.fromEntries(
		fields
			.filter((field) => !field.sensitive)
			.map((field) => [field.path, syntheticValue(field.path, field.type, field.enum, field.default)]),
	);

	const indexes = entry.model.schema.indexes().map(([keys, options]) => ({
		keys,
		options,
	}));
	const leakedSensitivePaths = fields
		.filter((field) => field.sensitive && Object.hasOwn(example, field.path))
		.map((field) => field.path);
	if (leakedSensitivePaths.length > 0) {
		throw new Error(
			`${entry.model.modelName} synthetic preview contains sensitive fields: ${leakedSensitivePaths.join(', ')}`,
		);
	}

	return {
		model: entry.model.modelName,
		collection: entry.model.collection.collectionName,
		context: entry.context,
		purpose: entry.purpose,
		source: entry.source,
		status: 'current-model',
		fields,
		indexes,
		example,
		limitations: [
			...new Set(
				fields
					.filter((field) => field.temporaryShape)
					.map((field) => `${field.path} uses a temporary Mixed shape.`),
			),
		],
	};
}

async function generate(): Promise<void> {
	const outputDirectory = resolve(readArgument('--output') ?? resolve(packageRoot, 'catalogue-dist'));
	const assetDirectory = resolve(packageRoot, 'catalogue');
	const sharedTheme = resolve(repositoryRoot, 'apps/developer-portal/src/css/nextgen-theme.css');
	const models = modelSources.map(compileModel);
	const exportedModelNames = Object.entries(modelExports)
		.filter(
			([name, value]) =>
				name.endsWith('Model') && typeof value === 'function' && 'schema' in value && 'collection' in value,
		)
		.map(([, value]) => (value as CatalogueModel).modelName)
		.sort();
	const documentedModelNames = modelSources.map((entry) => entry.model.modelName).sort();
	if (JSON.stringify(exportedModelNames) !== JSON.stringify(documentedModelNames)) {
		throw new Error(
			`Catalogue model coverage drift: exported=${exportedModelNames.join(', ')} documented=${documentedModelNames.join(', ')}`,
		);
	}
	const payload = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString().slice(0, 10),
		status: 'scaffolded-current-evidence',
		sourcePolicy: 'Mongoose source metadata only; no database connection or record access.',
		counts: {
			currentModels: models.length,
			fields: models.reduce((total, model) => total + model.fields.length, 0),
			indexes: models.reduce((total, model) => total + model.indexes.length, 0),
			temporaryShapes: models.reduce(
				(total, model) => total + model.fields.filter((field) => field.temporaryShape).length,
				0,
			),
		},
		models,
	};

	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		cp(resolve(assetDirectory, 'index.html'), resolve(outputDirectory, 'index.html')),
		cp(resolve(assetDirectory, 'app.js'), resolve(outputDirectory, 'app.js')),
		cp(resolve(assetDirectory, 'styles.css'), resolve(outputDirectory, 'styles.css')),
		cp(sharedTheme, resolve(outputDirectory, 'nextgen-theme.css')),
		writeFile(resolve(outputDirectory, 'catalogue.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
	]);

	const generatedIndex = await readFile(resolve(outputDirectory, 'index.html'), 'utf8');
	if (!generatedIndex.includes('Schema Observatory')) {
		throw new Error('Generated catalogue shell is missing its Schema Observatory identity.');
	}
	process.stdout.write(
		`Generated current-model MongoDB catalogue: ${payload.counts.currentModels} models, ${payload.counts.fields} fields, ${payload.counts.indexes} indexes\n`,
	);
}

void generate();
