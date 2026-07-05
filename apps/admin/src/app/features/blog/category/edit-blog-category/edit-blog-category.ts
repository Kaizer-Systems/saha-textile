import { Component } from '@angular/core';

import { EditCategory } from '../../../category/edit-category/edit-category';

@Component({
	selector: 'app-edit-blog-category',
	templateUrl: './edit-blog-category.html',
	styleUrls: ['./edit-blog-category.scss'],
	imports: [EditCategory],
})
export class EditBlogCategory {}
