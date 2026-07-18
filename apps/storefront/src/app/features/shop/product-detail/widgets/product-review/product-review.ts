import { DatePipe } from '@angular/common';
import { Component, viewChild, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbRating } from '@ng-bootstrap/ng-bootstrap';

import { IProduct } from '@data-access/interfaces/product.interface';
import { IReview } from '@data-access/interfaces/review.interface';
import { Button } from '@shared/ui/button/button';
import { ReviewModal } from '@shared/ui/modal/review-modal/review-modal';
import { NoData } from '@shared/ui/no-data/no-data';

@Component({
	selector: 'app-product-review',
	templateUrl: './product-review.html',
	styleUrls: ['./product-review.scss'],
	imports: [Button, NgbRating, NoData, ReviewModal, DatePipe, TranslocoModule],
})
export class ProductReview {
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct | null>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly reviews = input<IReview[]>([]);

	readonly ProfileModal = viewChild<ReviewModal>('reviewModal');
}
