import { Component, inject, viewChild, input } from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { ICategory } from '@data-access/interfaces/category.interface';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';

@Component({
	selector: 'app-tree-node',
	templateUrl: './tree-node.html',
	styleUrls: ['./tree-node.scss'],
	imports: [HasPermissionDirective, RouterModule, DeleteModal],
})
export class TreeNode {
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private categories = inject(CategoryService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly node = input<any>(undefined);
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
		return node.row?.name[this.locale()] || node[this.displayKey()] || node.name;
	}

	delete(_actionType: string, data: ICategory) {
		if (data.type == 'post') {
			void this.router.navigateByUrl('/blog/category');
			return;
		}
		this.categories.deleteCategory(data.id).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['categories'] });
				void this.router.navigateByUrl('/category');
			},
			error: () => this.notifier.showError(this.transloco.translate('category_rejected')),
		});
	}
}
