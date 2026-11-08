import { SlicePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IBlog } from '@data-access/interfaces/blog.interface';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';

@Component({
	selector: 'app-recent-post',
	templateUrl: './recent-post.html',
	styleUrls: ['./recent-post.scss'],
	imports: [RouterLink, SlicePipe, ShopDatePipe],
})
export class RecentPost {
	readonly blogs = input<IBlog[]>();

	constructor() {}
}
