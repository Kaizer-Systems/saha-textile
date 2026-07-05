import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ITag } from '@data-access/interfaces/tag.interface';

@Component({
  selector: 'app-blog-tag',
  templateUrl: './blog-tag.html',
  styleUrls: ['./blog-tag.scss'],
  imports: [RouterLink],
})
export class BlogTag {
  readonly tags = input<ITag[]>();

  constructor() {}
}
