# Contributing to gas-sheets-query

Thanks for your interest in contributing! This document explains how to set up
your environment and the workflow we follow.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) (this is a pnpm monorepo)

## Getting Started

```bash
# Install dependencies
pnpm install

# Run the test suite
pnpm test

# Build all packages
pnpm build

# Watch mode during development
pnpm dev
```

## Repository Layout

This is a monorepo managed with pnpm workspaces:

```
packages/
├── core/     # Core library (SheetsDB, QueryBuilder)
├── cli/      # CLI tools (gsquery)
├── client/   # Generated typed client runtime
└── skills/   # AI coding assistant skills
```

## Branching Strategy

Trunk-based. `main` is the only long-lived branch -- branch off it and open
your pull request **against `main`**:

```bash
git checkout main
git pull
git checkout -b feat/your-feature
```

Use a `feat/` `fix/` `chore/` or `docs/` prefix, keep the branch to one change,
and delete it after merge.

Pull requests are **squash-merged**, so the PR title becomes the commit message
on `main` -- write it as a [Conventional Commit](https://www.conventionalcommits.org/).
Releases are cut from those commits automatically, so a mistyped title means a
missing changelog entry or a missed version bump.

## Development Workflow

1. **Write tests first (TDD)** — add or update tests before implementing.
2. **Implement** your change.
3. **Verify locally** before opening a PR:
   ```bash
   pnpm test
   pnpm build
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
5. Push your branch and open a pull request to `main`.

## Commit & Code Conventions

- **English only** — all code comments, documentation, and commit messages.
- **Type-safe** — strict TypeScript, avoid `any`.
- Keep functions small and focused; prefer early returns over deep nesting.
- Follow the existing style of the surrounding code.

## Pull Requests

- Fill out the pull request template.
- Link any related issues (e.g. `Closes #123`).
- Make sure tests and the build pass.
- Keep PRs focused; smaller PRs are easier to review.

## Reporting Issues

Use the issue templates to report bugs or request features. Please include
enough detail to reproduce the problem (environment, version, steps).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
