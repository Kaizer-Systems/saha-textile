import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
	ServiceUnavailableException,
} from '@nestjs/common';
import {
	DocumentFormat,
	DocumentGroup,
	shopOnDocument,
	DocumentKind,
	type DocumentBlock,
	type DocumentFormatCreate,
	type DocumentFormatPreview,
	type DocumentFormatsView,
	type DocumentFormatSwitchResult,
	type DocumentFormatWrite,
	type DocumentPaper,
} from '@saha-textile/contracts';
import {
	type DocumentFormatRepository,
	type DocumentNumberingRepository,
	type DocumentRenderRequest,
	type DocumentRendererPort,
	type ShopDetailsRepository,
	blankBlocks,
	checkFormatBlocks,
	DOCUMENT_SPECS,
	documentSpec,
	fiscalYearOf,
	istDay,
	numberingExamples,
	ourBlocks,
	switchOffRefusal,
} from '@saha-textile/core-domain';
import { randomUUID } from 'node:crypto';

import {
	DOCUMENT_FORMAT_REPOSITORY,
	DOCUMENT_NUMBERING_REPOSITORY,
	DOCUMENT_RENDERER,
	SHOP_DETAILS_REPOSITORY,
} from '../infra/tokens';
import { PurchaseOrderDocument } from '../purchasing/purchase-order-document';
import type { DocumentData } from './document-data';
import { documentHtml, eInvoiceBand, type RenderBrand } from './document-html';
import { previewDocument } from './document-previews';

/** Fonts the PDF embeds (the preview uses the system's sans). */
const FONT_FACES = `@font-face{font-family:'Public Sans';src:url('fonts/public-sans-normal-100-900-latin.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'Public Sans';src:url('fonts/public-sans-normal-100-900-latin-ext.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'Noto Sans Bengali';src:url('fonts/noto-sans-bengali-normal-400-600-bengali.woff2') format('woff2');font-weight:400 600}`;

/** Where each document's "numbers like" example comes from in Settings › Document numbers. */
const NUMBER_KEY: Partial<Record<DocumentKind, string>> = { packingSlip: 'parcel', returnNote: 'return' };

/**
 * Settings › Document formats (bundle builder brief F01–F05, approved 2026-11-22; owner: builders in this build).
 * Lists every document's formats with its spec, makes and saves layouts after core's checks, keeps exactly one active
 * format per document, and renders a format with a document's data to HTML (live preview) or PDF.
 */
@Injectable()
export class DocumentFormatsService {
	constructor(
		@Inject(DOCUMENT_FORMAT_REPOSITORY) private readonly formats: DocumentFormatRepository,
		@Inject(DOCUMENT_NUMBERING_REPOSITORY) private readonly numbering: DocumentNumberingRepository,
		private readonly paperwork: PurchaseOrderDocument,
		@Optional() @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentRendererPort | null = null,
		@Optional() @Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: ShopDetailsRepository | null = null,
	) {}

	/**
	 * Our own name, address and GSTIN as documents print them (Settings › Shop details); the example's seller until
	 * the shop has saved its details.
	 */
	async seller(fallback: DocumentData['seller']): Promise<DocumentData['seller']> {
		const [details, brand] = await Promise.all([
			this.shop?.get().catch(() => null) ?? null,
			this.paperwork.brandFacts().catch(() => ({ shopName: 'Saha Textile', logoUrl: null })),
		]);
		if (!details || (!details.legalName && !details.address)) return fallback;
		const shop = shopOnDocument(details, brand.shopName);
		return {
			name: shop.legalName,
			lines: [
				...(shop.tradeName ? [shop.tradeName] : []),
				...shop.addressLines,
				...(shop.gstin ? [`GSTIN ${shop.gstin}`] : []),
				[shop.phone, shop.email].filter(Boolean).join(' · '),
			].filter(Boolean),
		};
	}

	async view(): Promise<DocumentFormatsView> {
		const [all, settings] = await Promise.all([this.formats.list(), this.numbering.get().catch(() => null)]);
		const examples = settings ? numberingExamples(settings, fiscalYearOf(istDay(new Date()))) : {};
		return {
			groups: DocumentGroup.options.map((group) => ({
				group,
				documents: DocumentKind.options
					.filter((doc) => DOCUMENT_SPECS[doc].group === group)
					.map((doc) => ({
						doc,
						numberExample: examples[NUMBER_KEY[doc] ?? doc] ?? null,
						spec: documentSpec(doc),
						formats: all.filter((format) => format.doc === doc),
					})),
			})),
		};
	}

	async one(id: string): Promise<DocumentFormat> {
		const format = await this.formats.findById(id);
		if (!format) throw new NotFoundException({ code: 'document_format_not_found' });
		return format;
	}

	/** Make new layout (F04): from our format or blank, switched off until the shop switches it on. */
	async create(body: DocumentFormatCreate, by: string): Promise<DocumentFormat> {
		const blocks = body.from === 'blank' ? blankBlocks(body.doc) : ourBlocks(body.doc);
		return this.formats.create(
			DocumentFormat.parse({
				id: `dfm_${randomUUID()}`,
				doc: body.doc,
				name: body.name,
				about: body.from === 'blank' ? 'Made from blank' : 'Copy of our format',
				paper: 'a4',
				blocks,
				active: false,
				seeded: false,
				version: 1,
				updatedAt: null,
				updatedBy: by,
			}),
		);
	}

	async duplicate(id: string, by: string): Promise<DocumentFormat> {
		const source = await this.one(id);
		return this.formats.create(
			DocumentFormat.parse({
				...source,
				id: `dfm_${randomUUID()}`,
				name: `${source.name} (copy)`.slice(0, 60),
				about: `Copy of ${source.name}`.slice(0, 120),
				active: false,
				seeded: false,
				version: 1,
				updatedAt: null,
				updatedBy: by,
			}),
		);
	}

	/** Save format (F05): core's checks first; a clash with someone else's save is refused, not overwritten. */
	async update(id: string, body: DocumentFormatWrite, by: string): Promise<DocumentFormat> {
		const format = await this.one(id);
		this.check(format.doc, body.blocks);
		const saved = await this.formats.update(
			{ ...format, name: body.name, about: body.about, paper: body.paper, blocks: body.blocks, updatedBy: by },
			body.version,
		);
		if (!saved) throw new ConflictException({ code: 'document_format_changed' });
		return saved;
	}

	/** Switching a format on (F02): the document's other format goes off in the same transaction. */
	async switchOn(id: string, by: string): Promise<DocumentFormatSwitchResult> {
		const result = await this.formats.switchOn(id, by);
		if (!result) throw new NotFoundException({ code: 'document_format_not_found' });
		return { active: result.on, switchedOff: result.off };
	}

	/** Switching the active format off is refused (F03), saying what to do instead. */
	async switchOff(id: string): Promise<never> {
		const format = await this.one(id);
		if (!format.active) throw new BadRequestException({ code: 'document_format_already_off' });
		const all = await this.formats.list();
		throw new ConflictException({ code: `document_format_${switchOffRefusal(all, id)}` });
	}

	/** The builder's live preview: the document's example drawn with these (possibly unsaved) blocks. */
	async previewHtml(id: string, draft: DocumentFormatPreview | null): Promise<string> {
		const format = await this.draftOf(id, draft);
		const logo = await this.paperwork.logo();
		const brand: RenderBrand = {
			logoSrc: logo.asset
				? `data:${logo.asset.contentType};base64,${Buffer.from(logo.asset.data).toString('base64')}`
				: null,
			themeColor: logo.themeColor,
			fontFaces: '',
		};
		const example = previewDocument(format.doc);
		return documentHtml(format, { ...example, seller: await this.seller(example.seller) }, brand);
	}

	async previewPdf(id: string, draft: DocumentFormatPreview | null): Promise<{ fileName: string; data: Uint8Array }> {
		const format = await this.draftOf(id, draft);
		const example = previewDocument(format.doc);
		const data = { ...example, seller: await this.seller(example.seller) };
		return { fileName: `${format.name} - example.pdf`, data: await this.pdf(format, data) };
	}

	/** A real document on its document's active format (packing slips, purchase orders…). */
	async renderActive(doc: DocumentKind, data: DocumentData): Promise<Uint8Array> {
		const format = await this.formats.findActive(doc);
		const blocks = format?.blocks ?? ourBlocks(doc);
		return this.pdf({ name: format?.name ?? 'Saha Textile standard', paper: format?.paper ?? 'a4', blocks }, data);
	}

	private async pdf(
		format: { name: string; paper: DocumentPaper; blocks: readonly DocumentBlock[] },
		data: DocumentData,
	): Promise<Uint8Array> {
		if (!this.renderer) throw new ServiceUnavailableException({ code: 'documents_unavailable' });
		const [assets, logo] = await Promise.all([this.paperwork.loadStatic(), this.paperwork.logo()]);
		const band = eInvoiceBand(format, data);
		const request: DocumentRenderRequest = {
			html: documentHtml(
				format,
				data,
				{ logoSrc: logo.asset ? 'logo' : null, themeColor: logo.themeColor, fontFaces: FONT_FACES },
				{ band: !!band },
			),
			...(band ? { footerHtml: band } : {}),
			assets: logo.asset ? [...assets, logo.asset] : assets,
			title: `${data.title} ${data.number}`,
			author: data.seller.name,
			// The HTML's own @page rule sets the paper (A4, A5 or the 80 mm roll) and its margins.
			page: { size: 'A4', landscape: false, marginMm: { top: 14, right: 12, bottom: 16, left: 12 } },
		};
		return this.renderer.renderPdf(request);
	}

	private async draftOf(
		id: string,
		draft: DocumentFormatPreview | null,
	): Promise<{ doc: DocumentKind; name: string; paper: DocumentPaper; blocks: DocumentBlock[] }> {
		const format = await this.one(id);
		if (!draft) return format;
		this.check(format.doc, draft.blocks);
		return { ...format, paper: draft.paper, blocks: draft.blocks };
	}

	private check(doc: DocumentKind, blocks: readonly DocumentBlock[]): void {
		const problems = checkFormatBlocks(doc, blocks);
		if (problems.length) throw new BadRequestException({ code: 'document_format_invalid', problems });
	}
}
