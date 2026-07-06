import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

import { STORAGE_ENGINE, StorageEngine } from '@ngxs/storage-plugin';

import { appConfig } from './app.config';

// The NGXS storage plugin defaults its STORAGE_ENGINE to `localStorage`, which
// doesn't exist under Nitro/platform-server (hard 500 during SSR). Provide an
// in-memory engine on the server so persisted state hydrates to empty during
// render; the browser re-reads real localStorage on client bootstrap. This
// override wins because server providers merge after appConfig's.
class MemoryStorageEngine implements StorageEngine {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, val: string): void {
    this.store.set(key, val);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    { provide: STORAGE_ENGINE, useClass: MemoryStorageEngine },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
