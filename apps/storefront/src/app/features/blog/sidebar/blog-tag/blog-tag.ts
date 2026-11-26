import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiBlogTerm } from '@data-access/interfaces/blog.interface';

@Component({
	selector: 'app-blog-tag',
	templateUrl: './blog-tag.html',
	styleUrls: ['./blog-tag.scss'],
	imports: [RouterLink],
})
export class BlogTag {
	readonly tags = input<ApiBlogTerm[]>();

	constructor() {}
}
