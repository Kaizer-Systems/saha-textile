import { ViewportScroller } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type Params, Router } from '@angular/router';

import { CODE_TABS, type CodeTab, linesOf } from './code-view';
import { ConsoleContext } from '../../data/console-context';

/**
 * Where the Code page is, read from its address (`?tab=files&ref=dev&path=apps/api&type=tree#L35`), so any page,
 * file or marked lines can be linked and opened again, as on GitHub. One per Code page.
 */
@Injectable()
export class CodeNav {
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly scroller = inject(ViewportScroller);
	readonly ctx = inject(ConsoleContext);
	private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
	private readonly fragment = toSignal(this.route.fragment, { initialValue: null });

	/** Go to file (t, or its button) is open. */
	readonly finding = signal(false);
	readonly p = computed(() => this.ctx.projectId() ?? '');
	readonly r = computed(() => this.ctx.repoId() ?? '');
	readonly tab = computed<CodeTab>(() => CODE_TABS.find((t) => t === this.params().get('tab')) ?? 'files');
	/** The branch, tag or commit shown; the default branch when the address names none. */
	readonly ref = computed(() => this.params().get('ref') ?? '');
	readonly path = computed(() => this.params().get('path') ?? '');
	/** A file shown as Code, Blame or (Markdown) Preview. */
	readonly view = computed(() => this.params().get('view') ?? '');
	readonly lines = computed(() => linesOf(this.fragment()));
	param(name: string): string {
		return this.params().get(name) ?? '';
	}

	/**
	 * Opens another place of the Code page; what is not named is kept, and null removes it. `top` starts the page at
	 * its top, as GitHub does for a new folder, file or tab; `replace` takes the current address's place in the
	 * history instead of adding one.
	 */
	go(params: Params, fragment: string | null = null, top = false, replace = false): void {
		void this.router
			.navigate([], {
				queryParams: params,
				queryParamsHandling: 'merge',
				fragment: fragment ?? undefined,
				replaceUrl: replace,
			})
			.then(() => {
				if (top) this.scroller.scrollToPosition([0, 0]);
			});
	}
	/** A tab, leaving the other tabs' places behind, from the top of the page. */
	open(tab: CodeTab, more: Params = {}): void {
		this.go({ tab, type: null, view: null, path: null, page: null, after: null, ...more }, null, true);
	}
	/** A folder or a file on a ref, from the top of the page; marked lines (`#L35`) scroll to themselves. */
	at(ref: string, path: string, type: 'tree' | 'blob', fragment: string | null = null, replace = false): void {
		this.go(
			{ tab: 'files', ref, path: path || null, type: type === 'blob' ? 'blob' : null, view: null },
			fragment,
			!fragment,
			replace,
		);
	}
	/** The console's address of a place, for a link to copy (a permalink pins the ref to a commit). */
	link(more: Params, fragment: string | null = null): string {
		const tree = this.router.createUrlTree([], {
			relativeTo: this.route,
			queryParams: more,
			queryParamsHandling: 'merge',
			fragment: fragment ?? undefined,
		});
		return `${location.origin}${this.router.serializeUrl(tree)}`;
	}
}
