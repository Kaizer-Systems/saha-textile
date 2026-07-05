import { Component } from '@angular/core';

import { Category } from '../../../category/category';

@Component({
	selector: 'app-blog-category',
	templateUrl: './blog-category.html',
	styleUrls: ['./blog-category.scss'],
	imports: [Category],
})
export class BlogCategory {}
