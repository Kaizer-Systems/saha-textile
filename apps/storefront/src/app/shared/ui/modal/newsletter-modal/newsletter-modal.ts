import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, inject, viewChild } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { UpdateSessionAction } from '@data-access/actions/theme-option.action';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
import { Button } from '../../button/button';

@Component({
  selector: 'app-newsletter-modal',
  templateUrl: './newsletter-modal.html',
  styleUrls: ['./newsletter-modal.scss'],
  imports: [Button, ReactiveFormsModule, FormsModule, TranslateModule],
})
export class NewsletterModal {
  private modalService = inject(NgbModal);
  private store = inject(Store);
  private platformId = inject<Object>(PLATFORM_ID);

  readonly NewsletterModal = viewChild<TemplateRef<string>>('newsletterModal');

  newsletter$: Observable<boolean> = inject(Store).select(ThemeOptionState.newsletter);

  public closeResult: string;
  public modalOpen: boolean = true;
  public newsletter: boolean;

  constructor() {
    this.newsletter$.subscribe(res => (this.newsletter = res));
  }

  ngAfterViewInit(): void {
    if (this.newsletter === true) {
      setTimeout(() => {
        void this.openModal();
      }, 3000);
      this.store.dispatch(new UpdateSessionAction('newsletter', false));
    }
  }

  async openModal() {
    if (isPlatformBrowser(this.platformId)) {
      this.modalOpen = true;
      this.modalService
        .open(this.NewsletterModal(), {
          ariaLabelledBy: 'profile-Modal',
          centered: true,
          windowClass: 'theme-modal modal-lg newsletter-modal',
        })
        .result.then(
          result => {
            `Result ${result}`;
          },
          reason => {
            this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
          },
        );
    }
  }

  private getDismissReason(reason: ModalDismissReasons): string {
    if (reason === ModalDismissReasons.ESC) {
      return 'by pressing ESC';
    } else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
      return 'by clicking on a backdrop';
    } else {
      return `with: ${reason}`;
    }
  }

  submit(_email: string) {
    // Add Newsletter Logic Here
    this.modalService.dismissAll();
  }

  ngOnDestroy() {
    if (this.modalOpen) {
      this.modalService.dismissAll();
    }
  }
}
