import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Native + heavy SDK packages stay external; everything else is bundled.
  external: ['sharp', '@libsql/client', '@aws-sdk/client-s3'],
  banner: {
    js: [
      "import { createRequire as __dbdCreateRequire } from 'node:module';",
      'const require = __dbdCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
