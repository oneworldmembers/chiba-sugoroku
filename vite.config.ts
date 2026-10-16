import { defineConfig } from 'vite';

// GitHub Pages（https://<user>.github.io/<repo>/）でも動くよう相対パスで出力する
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
