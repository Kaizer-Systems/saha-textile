import { Component, computed, input } from '@angular/core';

/**
 * A few product pictures overlapping like a fanned hand, with "+N" for the rest (owner, 22 Nov 2026: My orders on
 * phones). Fixed sizes and lazy pictures, so it never shifts the page while they load. Usable wherever a short list
 * of products needs a face: an order, a cart, a wish list.
 */
@Component({
	selector: 'app-thumb-stack',
	templateUrl: './thumb-stack.html',
	styleUrls: ['./thumb-stack.scss'],
})
export class ThumbStack {
	readonly images = input<readonly string[]>([]);
	/** How many more items there are than pictures shown. */
	readonly more = input(0);
	/** How many pictures to show at most. */
	readonly max = input(3);
	readonly size = input<'sm' | 'md'>('md');

	readonly shown = computed(() => {
		const list = this.images().slice(0, this.max());
		return list.length ? list : ['assets/images/product.png'];
	});
	readonly extra = computed(() => this.more() + Math.max(0, this.images().length - this.max()));
}
