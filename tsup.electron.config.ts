import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['electron/main.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    outDir: 'dist-electron',
    external: ['electron'],
    clean: true,
  },
  {
    entry: ['electron/preload.ts'],
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    outDir: 'dist-electron',
    external: ['electron'],
    clean: false,
    outExtension: () => ({ js: '.cjs' }),
  },
])
