import { Component } from '@angular/core';

import { EditTag } from '../../../tag/edit-tag/edit-tag';

@Component({
	selector: 'app-edit-blog-tag',
	templateUrl: './edit-blog-tag.html',
	styleUrls: ['./edit-blog-tag.scss'],
	imports: [EditTag],
})
export class EditBlogTag {}
