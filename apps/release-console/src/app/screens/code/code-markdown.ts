import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	afterRenderEffect,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';

import { CodeNav } from './code-nav';
import { codeLinkOf } from './code-view';
import { headingsIn } from '../pulls/pull-view';

/**
 * A Markdown file as GitHub draws it (a README, a community file, Preview), in the console's description look
 * (rc-md, approved C1 of the pull request page), with its headings in ☰ Outline. A link into this repository's files
 * opens here; every other link opens in a new tab; a picture GitHub will not show without its own sign-in becomes
 * its name and a link.
 */
@Component({
	selector: 'rc-code-markdown',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (outline().length && withOutline()) {
			<div class="rc-row end">
				<button
					type="button"
					class="rc-btn ghost rc-pr-outbtn"
					[attr.aria-expanded]="outlineShown()"
					(click)="outlineShown.set(!outlineShown())"
				>
					☰ Outline
				</button>
			</div>
			@if (outlineShown()) {
				<nav
					class="rc-pr-outline"
					aria-label="Outline"
				>
					@for (h of outline(); track h.id) {
						<button
							type="button"
							[class]="'h' + h.level"
							(click)="jump(h.id)"
						>
							{{ h.text }}
						</button>
					}
				</nav>
			}
		}
		<div
			#body
			class="rc-md"
			[innerHTML]="html()"
			(click)="follow($event)"
		></div>
	`,
})
export class CodeMarkdown {
	private readonly nav = inject(CodeNav);
	readonly html = input.required<string>();
	/** The repository's address on GitHub, to tell its own links apart. */
	readonly repoUrl = input.required<string>();
	readonly ref = input.required<string>();
	readonly withOutline = input(true);
	private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
	readonly outline = signal<ReturnType<typeof headingsIn>>([]);
	readonly outlineShown = signal(false);

	constructor() {
		afterRenderEffect(() => {
			this.html();
			const el = this.body().nativeElement;
			this.outline.set(headingsIn(el));
			for (const a of el.querySelectorAll('a')) {
				a.target = '_blank';
				a.rel = 'noopener';
			}
			for (const img of el.querySelectorAll('img'))
				img.addEventListener('error', () => this.unshown(img), { once: true });
		});
	}

	unshown(img: HTMLImageElement): void {
		const a = document.createElement('a');
		a.href = img.src;
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = `Picture: ${img.alt || img.src.split('/').pop()} ↗`;
		img.replaceWith(a);
	}

	follow(e: MouseEvent): void {
		const a = (e.target as HTMLElement).closest('a');
		const at = a ? codeLinkOf(a.href, this.repoUrl(), this.ref()) : null;
		if (!at) return;
		e.preventDefault();
		this.nav.at(at.ref, at.path, at.type, at.fragment);
	}

	jump(id: string): void {
		this.body().nativeElement.querySelector(`#${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		this.outlineShown.set(false);
	}
}
