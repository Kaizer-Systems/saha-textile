import { Component, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-blog',
  templateUrl: './skeleton-blog.html',
  styleUrls: ['./skeleton-blog.scss'],
  imports: [],
})
export class SkeletonBlog {
  readonly type = input<string>('grid');

  constructor() {}
}
