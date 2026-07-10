import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  HostListener,
  PLATFORM_ID,
  TemplateRef,
  inject,
  viewChild,
} from '@angular/core';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import { ThemeOptionStore } from '@core/state/theme-option.store';
import { Button } from '../../button/button';

@Component({
  selector: 'app-exit-modal',
  templateUrl: './exit-modal.html',
  styleUrls: ['./exit-modal.scss'],
  imports: [Button, TranslateModule],
})
export class ExitModal {
  private modalService = inject(NgbModal);
  private themeOptionStore = inject(ThemeOptionStore);
  private platformId = inject<Object>(PLATFORM_ID);

  readonly ExitModal = viewChild<TemplateRef<string>>('exitModal');

  exit$: Observable<boolean> = toObservable(this.themeOptionStore.exit) as Observable<boolean>;

  public closeResult: string;
  public modalOpen: boolean = true;
  public isTabInFocus = true;
  public exit: boolean;

  constructor() {
    this.exit$.subscribe(res => (this.exit = res));
  }

  @HostListener('window:mouseout', ['$event'])
  onMouseOut(event: MouseEvent) {
    if (event.clientY <= 0) {
      if (this.exit === true) {
        void this.openModal();
        this.themeOptionStore.updateSession('exit', false);
      }
    }
  }

  async openModal() {
    if (isPlatformBrowser(this.platformId)) {
      // localStorage.setItem("exit", 'true');
      this.modalOpen = true;
      this.modalService
        .open(this.ExitModal(), {
          ariaLabelledBy: 'profile-Modal',
          centered: true,
          windowClass: 'theme-modal modal-lg exit-modal',
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
}
