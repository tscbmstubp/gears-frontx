import { defineConfig } from 'tsup';
import { common } from './tsup.config';

// The development build. The build script runs it after the production build (tsup.config.ts),
// whose clean of dist/ would otherwise erase it.
export default defineConfig({
  ...common,
  outDir: 'dist/development',
  dts: false,
  clean: false,
  define: { __GEARS_BUILD_KIND__: JSON.stringify('development') },
});
