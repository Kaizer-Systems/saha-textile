import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { DocumentFormatService } from '@data-access/services/document-format.service';
import { NotificationService } from '@data-access/services/notification.service';

import { DOCUMENT_FORMATS_QUERY_KEY } from '../document-formats';

import type {
	DocumentBlock,
	DocumentBlockSpec,
	DocumentFormat,
	DocumentPaper,
	DocumentSpec,
} from '@saha-textile/contracts';

const SIZES = {
	heading: [8, 9, 10, 11, 12, 13, 14, 16],
	piece: [7, 8, 9, 10, 11, 12, 14],
	free: [7, 8, 9, 10, 11, 12, 14],
} as const;

/** The next free id for an added text block: `text-2`, `text-3`… (core's rule, kept here for the screen). */
function nextTextId(blocks: readonly DocumentBlock[]): string {
	const taken = new Set(blocks.map((block) => block.id));
	for (let n = 2; ; n += 1) if (!taken.has(`text-${n}`)) return `text-${n}`;
}

/**
 * A document's format builder (bundle builder brief F05; owner, 22 Nov 2026: the builders are in this build). Left:
 * the document's blocks, dragged into order, each with an eye to hide it (a block the law needs shows a lock).
 * Middle: the page, redrawn from the server as blocks change. Right: the chosen block's settings — only the fields
 * this document has, the law's fields ticked for good, the table's set rows and text sizes; with no block chosen,
 * the format's name, note and paper. Draft until saved; Preview PDF prints the unsaved layout.
 */
@Component({
	selector: 'app-format-builder',
	templateUrl: './format-builder.html',
	styleUrls: ['./format-builder.scss'],
	imports: [RouterLink, TranslocoModule, FormsModule, CdkDropList, CdkDrag, CdkDragHandle],
})
export class FormatBuilder {
	private readonly route = inject(ActivatedRoute);
	private readonly service = inject(DocumentFormatService);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly sanitizer = inject(DomSanitizer);
	private readonly destroyRef = inject(DestroyRef);

	readonly sizes = SIZES;
	readonly sizeKinds = ['heading', 'piece', 'free'] as const;
	readonly papers: readonly DocumentPaper[] = ['a4', 'a5', 'roll80'];
	private readonly formatId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
		initialValue: '',
	});

	private readonly listQuery = injectQuery(() => ({
		queryKey: DOCUMENT_FORMATS_QUERY_KEY,
		queryFn: () => firstValueFrom(this.service.list()),
	}));

	readonly format = signal<DocumentFormat | null>(null);
	readonly name = signal('');
	readonly about = signal('');
	readonly paper = signal<DocumentPaper>('a4');
	readonly blocks = signal<DocumentBlock[]>([]);
	readonly version = signal(1);
	readonly selectedId = signal<string | null>(null);
	readonly dirty = signal(false);
	readonly saving = signal(false);
	readonly preview = signal<SafeHtml | null>(null);
	readonly previewError = signal(false);
	readonly problems = signal<string[]>([]);

	readonly spec = computed<DocumentSpec | null>(() => {
		const doc = this.format()?.doc;
		for (const group of this.listQuery.data()?.groups ?? []) {
			const found = group.documents.find((row) => row.doc === doc);
			if (found) return found.spec;
		}
		return null;
	});
	/** Documents that print sets as a tree get the Sets and Text sizes settings (F05). */
	readonly treeDoc = computed(() => this.spec()?.tree === true);
	readonly selected = computed(() => this.blocks().find((block) => block.id === this.selectedId()) ?? null);
	readonly selectedSpec = computed(() => this.specOf(this.selected()));
	/** The document's blocks this layout doesn't hold yet (a blank start), offered to add back. */
	readonly missing = computed(() => {
		const have = new Set(this.blocks().map((block) => block.type));
		return (this.spec()?.blocks ?? []).filter((row) => row.type !== 'text' && !have.has(row.type));
	});

	private previewTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		effect(() => {
			const id = this.formatId();
			if (id) void this.load(id);
		});
		this.destroyRef.onDestroy(() => this.previewTimer && clearTimeout(this.previewTimer));
	}

	private async load(id: string): Promise<void> {
		const format = await firstValueFrom(this.service.one(id)).catch(() => null);
		if (!format) {
			this.notifier.showError(this.transloco.translate('docf_not_found'));
			return;
		}
		this.format.set(format);
		this.name.set(format.name);
		this.about.set(format.about);
		this.paper.set(format.paper);
		this.blocks.set(format.blocks.map((block) => ({ ...block, fields: [...block.fields] })));
		this.version.set(format.version);
		this.dirty.set(false);
		this.redraw(0);
	}

	specOf(block: DocumentBlock | null): DocumentBlockSpec | null {
		if (!block) return null;
		return this.spec()?.blocks.find((row) => row.type === block.type) ?? null;
	}

	/** The block's name in the list: its kind, or a text block's own heading. */
	label(block: DocumentBlock): string {
		if (block.type === 'text') {
			return this.transloco.translate('docf_block_text', {
				heading: block.heading || this.transloco.translate('docf_text_untitled'),
			});
		}
		return this.transloco.translate(`docf_block_${block.type}`);
	}

	required(block: DocumentBlock): boolean {
		return this.specOf(block)?.required === true;
	}

	locked(field: string): boolean {
		return this.selectedSpec()?.lockedFields.includes(field) === true;
	}

	drop(event: CdkDragDrop<DocumentBlock[]>): void {
		const next = [...this.blocks()];
		moveItemInArray(next, event.previousIndex, event.currentIndex);
		this.change(next);
	}

	toggleHidden(block: DocumentBlock, event: Event): void {
		event.stopPropagation();
		if (this.required(block)) return;
		this.change(this.blocks().map((row) => (row.id === block.id ? { ...row, hidden: !row.hidden } : row)));
	}

	/** A field on or off; on goes back to its place in the document's own order. */
	toggleField(field: string, on: boolean): void {
		const block = this.selected();
		const spec = this.selectedSpec();
		if (!block || !spec || this.locked(field)) return;
		const chosen = new Set(block.fields);
		if (on) chosen.add(field);
		else chosen.delete(field);
		const fields = spec.fields.filter((name) => chosen.has(name));
		this.patch(block.id, { fields });
	}

	setSize(kind: 'heading' | 'piece' | 'free', value: string): void {
		const block = this.selected();
		if (!block) return;
		const size = Number(value);
		this.patch(block.id, { sizes: { ...block.sizes, [kind]: Number.isFinite(size) ? size : undefined } });
	}

	setText(part: 'heading' | 'text', value: string): void {
		const block = this.selected();
		if (!block || block[part] === value) return;
		this.patch(block.id, { [part]: value });
	}

	addText(): void {
		const id = nextTextId(this.blocks());
		const block: DocumentBlock = {
			id,
			type: 'text',
			hidden: false,
			fields: [],
			heading: this.transloco.translate('docf_text_new_heading'),
			text: '',
			sizes: {},
		};
		// Above the signature when there is one, as notes print before it.
		const blocks = [...this.blocks()];
		const at = blocks.findIndex((row) => row.type === 'signature');
		blocks.splice(at < 0 ? blocks.length : at, 0, block);
		this.change(blocks);
		this.selectedId.set(id);
	}

	addBlock(spec: DocumentBlockSpec): void {
		const fields = spec.lockedFields.length ? [...spec.lockedFields] : [...spec.fields];
		const block: DocumentBlock = {
			id: spec.type,
			type: spec.type,
			hidden: false,
			fields,
			heading: '',
			text: '',
			sizes: {},
		};
		const order = (this.spec()?.blocks ?? []).map((row) => row.type);
		const rank = order.indexOf(spec.type);
		const blocks = [...this.blocks()];
		const at = blocks.findIndex((row) => order.indexOf(row.type) > rank && row.type !== 'text');
		blocks.splice(at < 0 ? blocks.length : at, 0, block);
		this.change(blocks);
		this.selectedId.set(block.id);
	}

	removeText(block: DocumentBlock, event: Event): void {
		event.stopPropagation();
		if (block.type !== 'text') return;
		this.change(this.blocks().filter((row) => row.id !== block.id));
		if (this.selectedId() === block.id) this.selectedId.set(null);
	}

	setName(value: string): void {
		if (value === this.name()) return;
		this.name.set(value);
		this.dirty.set(true);
	}

	setAbout(value: string): void {
		if (value === this.about()) return;
		this.about.set(value);
		this.dirty.set(true);
	}

	setPaper(value: DocumentPaper): void {
		if (value === this.paper()) return;
		this.paper.set(value);
		this.dirty.set(true);
		this.redraw();
	}

	private patch(id: string, part: Partial<DocumentBlock>): void {
		this.change(this.blocks().map((row) => (row.id === id ? { ...row, ...part } : row)));
	}

	private change(blocks: DocumentBlock[]): void {
		this.blocks.set(blocks);
		this.dirty.set(true);
		this.redraw();
	}

	/** The page is redrawn by the server a moment after the last change. */
	private redraw(wait = 350): void {
		if (this.previewTimer) clearTimeout(this.previewTimer);
		this.previewTimer = setTimeout(() => void this.fetchPreview(), wait);
	}

	private async fetchPreview(): Promise<void> {
		const format = this.format();
		if (!format) return;
		try {
			const html = await firstValueFrom(
				this.service.preview(format.id, { paper: this.paper(), blocks: this.blocks() }),
			);
			// Our own HTML, every value escaped by the server; the frame is sandboxed with no scripts.
			this.preview.set(this.sanitizer.bypassSecurityTrustHtml(html));
			this.previewError.set(false);
			this.problems.set([]);
		} catch (error) {
			this.previewError.set(true);
			this.problems.set(this.problemWords(error));
		}
	}

	async previewPdf(): Promise<void> {
		const format = this.format();
		if (!format) return;
		const blob = await firstValueFrom(
			this.service.draftPdf(format.id, { paper: this.paper(), blocks: this.blocks() }),
		).catch(() => null);
		if (!blob) {
			this.notifier.showError(this.transloco.translate('docf_pdf_failed'));
			return;
		}
		const url = URL.createObjectURL(blob);
		window.open(url, '_blank', 'noopener');
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}

	async save(): Promise<void> {
		const format = this.format();
		if (!format || this.saving()) return;
		this.saving.set(true);
		try {
			const saved = await firstValueFrom(
				this.service.save(format.id, {
					name: this.name().trim(),
					about: this.about().trim(),
					paper: this.paper(),
					blocks: this.blocks(),
					version: this.version(),
				}),
			);
			this.format.set(saved);
			this.version.set(saved.version);
			this.dirty.set(false);
			await this.queryClient.invalidateQueries({ queryKey: DOCUMENT_FORMATS_QUERY_KEY });
			this.notifier.showSuccess(this.transloco.translate('docf_saved_note', { name: saved.name }));
		} catch (error) {
			const code = (error as { error?: { code?: string } }).error?.code;
			this.problems.set(this.problemWords(error));
			this.notifier.showError(
				this.transloco.translate(code === 'document_format_changed' ? 'docf_changed' : 'docf_save_failed'),
			);
		} finally {
			this.saving.set(false);
		}
	}

	private problemWords(error: unknown): string[] {
		const problems = (error as { error?: { problems?: Array<{ code: string; field: string | null }> } }).error
			?.problems;
		return (problems ?? []).map((problem) =>
			this.transloco.translate(`docf_problem_${problem.code}`, {
				field: problem.field ? this.transloco.translate(`docf_field_${problem.field}`) : '',
			}),
		);
	}
}
