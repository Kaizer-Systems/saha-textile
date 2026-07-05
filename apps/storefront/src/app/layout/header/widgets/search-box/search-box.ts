import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-search-box',
  templateUrl: './search-box.html',
  styleUrls: ['./search-box.scss'],
  imports: [RouterLink],
})
export class SearchBox {
  readonly style = input<string>('basic');
}
