import { provideZoneChangeDetection } from "@angular/core";
// import { bootstrapApplication } from '@angular/platform-browser';

// import { App } from './app/app';
// import { config } from './app/app.config.server';

// const bootstrap = () => bootstrapApplication(App, config);

// export default bootstrap;


import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => {
  return bootstrapApplication(App, {...config, providers: [provideZoneChangeDetection(), ...config.providers]}, context);
};

export default bootstrap;
