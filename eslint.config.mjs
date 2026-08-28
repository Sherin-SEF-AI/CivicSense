import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const DASHES = /[—–]/

/**
 * Local rules that enforce the two design-language constraints that are easy to
 * regress silently: em-dashes in operator-visible copy, and pulling in an icon
 * library instead of using CS Glyphs.
 */
const civicsense = {
  rules: {
    'no-em-dash': {
      meta: {
        type: 'problem',
        docs: { description: 'UI copy uses commas, colons or hyphens, never em or en dashes' },
        schema: [],
        messages: { found: 'Em/en dash in UI copy. Use a comma, colon or hyphen.' },
      },
      create(context) {
        const report = (node, value) => {
          if (typeof value === 'string' && DASHES.test(value)) {
            context.report({ node, messageId: 'found' })
          }
        }
        return {
          JSXText: (node) => report(node, node.value),
          Literal: (node) => report(node, node.value),
          TemplateElement: (node) => report(node, node.value.raw),
        }
      },
    },
    'no-icon-library': {
      meta: {
        type: 'problem',
        docs: { description: 'Icons come from components/glyphs only' },
        schema: [],
        messages: { found: 'Icon libraries are not used in this project. Add a CS Glyph instead.' },
      },
      create(context) {
        const banned = /^(lucide-react|@heroicons|react-icons|@tabler\/icons|feather-icons)/
        return {
          ImportDeclaration(node) {
            if (banned.test(node.source.value)) context.report({ node, messageId: 'found' })
          },
        }
      },
    },
  },
}

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    plugins: { civicsense },
    rules: {
      'civicsense/no-em-dash': 'error',
      'civicsense/no-icon-library': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.{ts,mjs}', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off', 'civicsense/no-em-dash': 'off' },
  },
]

export default config
