import { defineConfig } from 'tsup';

const common = {
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'] as ('cjs' | 'esm')[],
  sourcemap: true,
  splitting: false,
  treeshake: true,
};

// Production first (cleans dist/); the development build must not erase it.
export default defineConfig([
  {
    ...common,
    outDir: 'dist',
    dts: true,
    clean: true,
    define: { __GEARS_BUILD_KIND__: JSON.stringify('production') },
  },
  {
    ...common,
    outDir: 'dist/development',
    dts: false,
    clean: false,
    define: { __GEARS_BUILD_KIND__: JSON.stringify('development') },
  },
]);
