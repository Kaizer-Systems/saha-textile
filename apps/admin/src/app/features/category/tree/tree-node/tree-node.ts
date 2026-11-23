import { Component, inject, viewChild, input } from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { ICategory } from '@data-access/interfaces/category.interface';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';

@Component({
	selector: 'app-tree-node',
	templateUrl: './tree-node.html',
	styleUrls: ['./tree-node.scss'],
	imports: [HasPermissionDirective, RouterModule, DeleteModal, TranslocoPipe],
})
export class TreeNode {
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private categories = inject(CategoryService);
	private blogs = inject(BlogService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);

	readonly node = input.required<ICategory>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly recursionKey = input<string>(undefined);
	readonly displayKey = input<string>(undefined);
	readonly locale = input('en');
	readonly categoryType = input<string | null>('product');

	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	public showChildrenNode: boolean = true;
	public id: string;

	ngOnInit() {
		this.route.params.subscribe((params) => (this.id = params['id']));
	}

	/** The name in the language on screen, or the English one until it has a translation. */
	label(): string {
		const node = this.node();
		const shown = (node as object as Record<string, unknown>)[this.displayKey()];
		return (node.row ?? node.blog)?.name[this.locale()] || (typeof shown === 'string' ? shown : '') || node.name;
	}

	/** The categories under this one, under the key the tree was given (`subcategories`). */
	children(): ICategory[] {
		const value = (this.node() as object as Record<string, unknown>)[this.recursionKey()];
		return Array.isArray(value) ? (value as ICategory[]) : [];
	}

	/** After the delete modal: it was opened for this node. */
	delete(data: ICategory) {
		const post = data.type == 'post';
		const call = post ? this.blogs.deleteTerm('categories', data.id) : this.categories.deleteCategory(data.id);
		call.subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['categories'] });
				void this.router.navigateByUrl(post ? '/blog/category' : '/category');
			},
			error: () => this.notifier.showError(this.transloco.translate('category_rejected')),
		});
	}
}
