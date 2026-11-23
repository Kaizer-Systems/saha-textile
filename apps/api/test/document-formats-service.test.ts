import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
	DEFAULT_DOCUMENT_NUMBERING,
	type DocumentFormat,
	type DocumentKind,
	ShopDetails,
} from '@saha-textile/contracts';
import { ourBlocks, seedDocumentFormats } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { DocumentFormatsService } from '../src/documents/document-formats.service';
import { previewDocument } from '../src/documents/document-previews';

/** The document formats service end to end with a stand-in renderer: sellers, layouts, previews and PDFs. */

const LOGO = { name: 'logo', contentType: 'image/png', data: new Uint8Array([1, 2, 3]) };

interface Options {
	shop?: unknown;
	shopFails?: boolean;
	brandFails?: boolean;
	numbering?: unknown;
	numberingFails?: boolean;
	logo?: boolean;
	renderer?: boolean;
	formats?: DocumentFormat[];
	updateClash?: boolean;
}

function setup(options: Options = {}) {
	const store = new Map((options.formats ?? seedDocumentFormats()).map((row) => [row.id, row]));
	const rendered: { html: string; footerHtml?: string; assets: unknown[]; title: string }[] = [];
	const repo = {
		list: async () => [...store.values()],
		findById: async (id: string) => store.get(id) ?? null,
		findActive: async (doc: DocumentKind) =>
			[...store.values()].find((row) => row.doc === doc && row.active) ?? null,
		create: async (row: DocumentFormat) => (store.set(row.id, row), row),
		update: async (row: DocumentFormat) => (options.updateClash ? null : (store.set(row.id, row), row)),
		switchOn: async () => null,
	};
	const numbering = {
		get: async () => {
			if (options.numberingFails) throw new Error('down');
			return options.numbering ?? null;
		},
	};
	const paperwork = {
		logo: async () => ({ asset: options.logo ? LOGO : null, shopName: 'Saha Textile', themeColor: '#123456' }),
		brandFacts: async () => {
			if (options.brandFails) throw new Error('down');
			return { shopName: 'Brand Shop', logoUrl: null };
		},
		loadStatic: async () => [],
	};
	const renderer = {
		renderPdf: async (request: (typeof rendered)[number]) => (rendered.push(request), new Uint8Array([37, 80])),
	};
	const shop = {
		get: async () => {
			if (options.shopFails) throw new Error('down');
			return options.shop ?? null;
		},
	};
	const service = new DocumentFormatsService(
		repo as never,
		numbering as never,
		paperwork as never,
		options.renderer === false ? null : (renderer as never),
		'shop' in options || options.shopFails ? (shop as never) : null,
	);
	return { service, rendered, store };
}

const fallback = { name: 'Example', lines: ['Example street'] };
const details = (patch: Record<string, unknown>) => ShopDetails.parse({ ...patch });

describe('the seller documents print (Settings › Shop details)', () => {
	it('uses the example without shop details, when they can’t be read, or when they are empty', async () => {
		expect(await setup().service.seller(fallback)).toBe(fallback);
		expect(await setup({ shopFails: true, brandFails: true }).service.seller(fallback)).toBe(fallback);
		expect(await setup({ shop: details({}) }).service.seller(fallback)).toBe(fallback);
	});

	it('prints the legal name, a different trade name, the address, GSTIN, phone and email', async () => {
		const full = details({
			legalName: 'Legal Name',
			tradeName: 'K.R. Marketing',
			address: '11/1A K.B. Bose Road',
			city: 'Barasat',
			pin: '700124',
			gstin: '19DBYPS6736R1ZZ',
			phone: '+91 98300 12345',
			email: 'orders@example.test',
		});
		expect(await setup({ shop: full }).service.seller(fallback)).toEqual({
			name: 'Legal Name',
			lines: [
				'K.R. Marketing',
				'11/1A K.B. Bose Road',
				'Barasat, West Bengal 700124',
				'GSTIN 19DBYPS6736R1ZZ',
				'+91 98300 12345 · orders@example.test',
			],
		});
		const bare = details({ legalName: 'Legal Name', address: 'Street' });
		expect((await setup({ shop: bare }).service.seller(fallback)).lines).toEqual(['Street']);
	});
});

describe('layouts and their numbering examples', () => {
	it('shows a number example per document when numbering is set, and none when it can’t be read', async () => {
		const withNumbers = await setup({
			numbering: DEFAULT_DOCUMENT_NUMBERING,
		}).service.view();
		const docs = withNumbers.groups.flatMap((g) => g.documents);
		expect(docs.find((d) => d.doc === 'taxInvoice')?.numberExample).toMatch(/^TI\//);
		const none = await setup({ numberingFails: true }).service.view();
		expect(none.groups.flatMap((g) => g.documents).every((d) => d.numberExample === null)).toBe(true);
	});

	it('refuses a layout it doesn’t know, a save someone else got to first, and a switch on of nothing', async () => {
		const { service } = setup();
		await expect(service.one('dfm_x')).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.switchOn('dfm_x', 'usr_1')).rejects.toBeInstanceOf(NotFoundException);
		const seed = seedDocumentFormats()[0]!;
		const clash = setup({ updateClash: true });
		await expect(
			clash.service.update(
				seed.id,
				{ name: 'x', about: '', paper: 'a4', blocks: seed.blocks, version: 1 },
				'usr_1',
			),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('makes a layout from blank or from ours, both switched off', async () => {
		const { service } = setup();
		for (const from of ['blank', 'ours'] as const) {
			const made = await service.create({ doc: 'taxInvoice', name: from, from } as never, 'usr_1');
			expect(made).toMatchObject({
				active: false,
				about: from === 'blank' ? 'Made from blank' : 'Copy of our format',
			});
		}
	});

	it('copies a layout switched off, and refuses switching off one that is already off', async () => {
		const { service } = setup();
		const seed = seedDocumentFormats()[0]!;
		const copy = await service.duplicate(seed.id, 'usr_1');
		expect(copy).toMatchObject({ active: false, name: `${seed.name} (copy)` });
		await expect(service.switchOff(copy.id)).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe('previews and PDFs', () => {
	const seed = seedDocumentFormats().find((f) => f.doc === 'taxInvoice')!;

	it('previews with the logo inlined, and an unsaved draft only when it passes the checks', async () => {
		const { service } = setup({ logo: true });
		expect(await service.previewHtml(seed.id, null)).toContain('data:image/png;base64,AQID');
		const draft = { paper: 'a5' as const, blocks: seed.blocks };
		expect(await service.previewHtml(seed.id, draft)).toContain('dz-paper-a5');
		await expect(service.previewHtml(seed.id, { paper: 'a4', blocks: [] })).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});

	it('renders the example PDF with the logo as an asset, and says when no renderer is set up', async () => {
		const { service, rendered } = setup({ logo: true });
		const pdf = await service.previewPdf(seed.id, null);
		expect(pdf.fileName).toBe(`${seed.name} - example.pdf`);
		expect(rendered[0]?.assets).toEqual([LOGO]);
		await expect(setup({ renderer: false }).service.previewPdf(seed.id, null)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});

	it('renders a real document on our format when none is active, with the e-invoice band in the foot', async () => {
		const { service, rendered } = setup({ formats: [] });
		const example = previewDocument('taxInvoice');
		const banded = { ...example, values: { ...example.values, irn: 'a'.repeat(64) } };
		await service.renderActive('taxInvoice', banded);
		expect(rendered[0]?.footerHtml).toContain('a'.repeat(64));
		const { irn: _irn, ...plainValues } = example.values;
		const plain = { ...example, values: plainValues };
		await service.renderActiveCopies('taxInvoice', [plain, plain]);
		expect(rendered[1]?.html.match(/break-before:page/g)).toHaveLength(1);
		expect(rendered[1]?.footerHtml).toBeUndefined();
		expect(ourBlocks('taxInvoice').length).toBeGreaterThan(0);
	});
});
