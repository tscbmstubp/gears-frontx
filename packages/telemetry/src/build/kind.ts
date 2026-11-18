// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-dev-builds:p1

export type BuildKind = 'development' | 'production';

// Substituted by tsup/Vitest `define`; absent define falls back to production.
declare const __GEARS_BUILD_KIND__: BuildKind | undefined;

// The package builds its main entry twice (tsup.config.ts): `dist/` with the production value and
// `dist/development/` with the development value. package.json's `development` export condition
// resolves to the second, so a bundler that matches that condition gets the development build and
// every other resolver gets the production one. Code that depends on the kind of build takes it as
// a parameter rather than reading the consumer's environment.
// @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-select-build
export const BUILD_KIND: BuildKind =
  typeof __GEARS_BUILD_KIND__ !== 'undefined' ? __GEARS_BUILD_KIND__ : 'production';
// @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-select-build
