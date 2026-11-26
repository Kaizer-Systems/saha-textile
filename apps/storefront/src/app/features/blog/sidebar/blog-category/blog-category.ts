import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiBlogTerm } from '@data-access/interfaces/blog.interface';

@Component({
	selector: 'app-blog-category',
	templateUrl: './blog-category.html',
	styleUrls: ['./blog-category.scss'],
	imports: [RouterLink],
})
export class BlogCategory {
	/** Live blog categories that hold a live post. Blog categories are flat. */
	readonly data = input<ApiBlogTerm[]>();
}
