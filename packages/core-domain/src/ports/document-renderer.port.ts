/**
 * Business documents as PDF (owner decision 2026-11-17: headless Chromium through Playwright).
 * Purchase orders today; debit notes, delivery challans, tax invoices, report exports and label
 * sheets later. Core hands over finished HTML and the files it may load; the adapter decides how
 * the PDF is made, so a move to another engine touches only the adapter and one binding.
 */
export interface DocumentAsset {
	/** The path the HTML uses, e.g. `fonts/inter.woff2` or `logo.png`. */
	path: string;
	contentType: string;
	data: Uint8Array;
}

export interface DocumentRenderRequest {
	/** A whole HTML document. Nothing outside `assets` is fetched: the network stays closed. */
	html: string;
	assets: readonly DocumentAsset[];
	/** Shown by PDF readers and kept in the file's details. */
	title: string;
	author: string;
	page: {
		size: 'A4';
		landscape: boolean;
		/** Millimetres; the HTML's own `@page` rules win when it sets them. */
		marginMm: { top: number; right: number; bottom: number; left: number };
	};
}

export interface DocumentRendererPort {
	renderPdf(request: DocumentRenderRequest): Promise<Uint8Array>;
}
