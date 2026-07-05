import { Component } from '@angular/core';

import { CreateTag } from '../../../tag/create-tag/create-tag';

@Component({
	selector: 'app-create-blog-tag',
	templateUrl: './create-blog-tag.html',
	styleUrls: ['./create-blog-tag.scss'],
	imports: [CreateTag],
})
export class CreateBlogTag {}
