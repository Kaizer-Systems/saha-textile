import { Component, DOCUMENT, inject, NgZone } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';

import { NgbRatingConfig } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { Layout } from '@layout/layout';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionStore } from '@core/state/theme-option.store';

@Component({
  selector: 'app-root',
  imports: [RouterModule, Layout],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // The global shell (header/footer/widgets + one-time data loads) lives in
  // Layout, rendered here ABOVE the router — Analog's pathless-layout convention
  // is a parens route group, which @analogjs/vite-plugin-angular fails to
  // transform. Maintenance is the one full-page route that skips the shell.
  protected get showLayout(): boolean {
    return !this.router.url.startsWith('/maintenance');
  }

  private router = inject(Router);
  private titleService = inject(Title);
  private ngZone = inject(NgZone);
  private meta = inject(Meta);

  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  public favIcon: HTMLLinkElement | null;
  public isTabInFocus = true;
  public timeoutId: ReturnType<typeof setTimeout>;
  private currentMessageIndex = 0;
  private messages = ['⚡ Come Back !!', '🎉 Offers for you...'];
  private currentMessage: string;
  private delay = 1000; // Delay between messages in milliseconds

  constructor() {
    const document = inject<Document>(DOCUMENT);
    const config = inject(NgbRatingConfig);

    config.max = 5;
    config.readonly = true;

    this.themeOption$.subscribe(theme => {
      if (theme?.general?.mode === 'dark') {
        document
          .getElementsByTagName('html')[0]
          .classList.add(theme?.general && theme?.general?.mode);
      } else {
        document.getElementsByTagName('html')[0].classList.remove('dark');
      }

      // Set Direction
      if (theme?.general?.language_direction === 'rtl') {
        document.getElementsByTagName('html')[0].setAttribute('dir', 'rtl');
        document.body.classList.add('rtl');
      } else {
        document.getElementsByTagName('html')[0].removeAttribute('dir');
        document.body.classList.remove('rtl');
      }

      // Set Favicon
      this.favIcon = document.querySelector('#appIcon');
      this.favIcon!.href = theme?.logo?.favicon_icon?.original_url;

      theme?.seo?.og_title &&
        this.meta.updateTag({ property: 'og:title', content: theme?.seo?.og_title });
      theme?.seo?.og_description &&
        this.meta.updateTag({ property: 'og:description', content: theme?.seo?.og_description });
      theme?.seo?.og_image?.original_url &&
        this.meta.updateTag({ property: 'og:image', content: theme?.seo?.og_image?.original_url });
      theme?.seo?.meta_title &&
        this.meta.updateTag({ property: 'title', content: theme?.seo?.meta_title });
      theme?.seo?.meta_description &&
        this.meta.updateTag({ property: 'description', content: theme?.seo?.meta_description });
      theme?.seo?.meta_tags &&
        this.meta.updateTag({ property: 'keywords', content: theme?.seo?.meta_tags });

      document.addEventListener('visibilitychange', () => {
        this.ngZone.run(() => {
          this.isTabInFocus = !document.hidden;
          if (this.isTabInFocus) {
            clearTimeout(this.timeoutId);
            // Set site title
            return this.titleService.setTitle(
              theme?.general?.site_title && theme?.general?.site_tagline
                ? `${theme?.general?.site_title} | ${theme?.general?.site_tagline}`
                : 'FastKart Marketplace: Where Vendors Shine Together',
            );
          } else {
            this.updateMessage();
          }
        });
      });
    });
  }

  updateMessage() {
    // Clear the previous timeout
    clearTimeout(this.timeoutId);

    // Update the current message
    this.currentMessage = this.messages[this.currentMessageIndex];
    this.titleService.setTitle(this.currentMessage);
    // Increment the message index or reset it to 0 if it reaches the end
    this.currentMessageIndex = (this.currentMessageIndex + 1) % this.messages.length;

    // Set a new timeout to call the function again after the specified delay
    this.timeoutId = setTimeout(() => {
      this.updateMessage();
    }, this.delay);
  }

  ngOnDestroy() {
    // Clear the timeout when the component is destroyed
    clearTimeout(this.timeoutId);
  }
}
