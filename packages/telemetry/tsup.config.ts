import { defineConfig, type Options } from 'tsup';

export const common: Options = {
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  sourcemap: true,
  splitting: false,
  treeshake: true,
};

// The production build, which cleans dist/. tsup runs the entries of one config array at the same
// time, so the development build has its own config (tsup.development.config.ts) and the build
// script runs it only after this one has finished; otherwise this clean could erase its output.
export default defineConfig({
  ...common,
  outDir: 'dist',
  dts: true,
  clean: true,
  define: { __GEARS_BUILD_KIND__: JSON.stringify('production') },
});
