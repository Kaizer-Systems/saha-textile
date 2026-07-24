import { Component, inject, viewChild, input } from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';

import { ICategory } from '@data-access/interfaces/category.interface';
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

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly node = input<any>(undefined);
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly recursionKey = input<string>(undefined);
	readonly displayKey = input<string>(undefined);
	readonly categoryType = input<string | null>('product');

	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	public showChildrenNode: boolean = true;
	public id: number;

	ngOnInit() {
		this.route.params.subscribe((params) => (this.id = params['id']));
	}

	delete(_actionType: string, data: ICategory) {
		// Delete has no backend yet — mirror the post-delete navigation locally.
		if (data.type == 'post') void this.router.navigateByUrl('/blog/category');
		else void this.router.navigateByUrl('/category');
	}
}
