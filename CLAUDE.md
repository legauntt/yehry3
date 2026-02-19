# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working in this repository.

## Project Overview

**Name:** yehry3
**License:** Unlicense (public domain) — see `LICENSE`
**Status:** Early initialization. No application source code exists yet.

## Repository Structure

```
yehry3/
├── .gitignore      # Node.js / JavaScript ecosystem ignore rules
├── LICENSE         # Unlicense (public domain)
├── README.md       # Minimal project readme
└── CLAUDE.md       # This file
```

## Technology Stack

No source code has been added yet. The `.gitignore` file is a standard Node.js template covering:

- **Package managers:** npm, yarn (v1 and v3/berry), pnpm
- **Build tools:** Vite, Parcel, Webpack, Snowpack, FuseBox
- **Frameworks:** Next.js, Nuxt.js, SvelteKit, VuePress, Docusaurus, Gatsby
- **Language:** TypeScript (`.tsbuildinfo` is ignored)
- **Testing/coverage:** Istanbul/nyc, JSCover

When the project's stack is decided and scaffolded, update this file accordingly.

## Development Workflow

Since no build or test system exists yet, there are no runnable commands. Once the project is set up, document them here in the following format:

```bash
# Install dependencies
npm install          # or: yarn install / pnpm install

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Lint / format
npm run lint
npm run format
```

## Git Conventions

- **Default branch:** `master`
- **Feature branches:** Use descriptive names (e.g., `feat/user-auth`, `fix/login-bug`)
- **Commit messages:** Use conventional commits style when possible:
  - `feat:` new feature
  - `fix:` bug fix
  - `chore:` tooling, config, or maintenance changes
  - `docs:` documentation only changes
  - `refactor:` code restructuring without behavior change
  - `test:` adding or updating tests
- **No force-pushing** to `master`

## AI Assistant Guidelines

### Before Making Changes
- Read relevant files before modifying them
- Understand the existing code structure and conventions before adding new code
- Check for existing utilities/helpers before creating new ones

### Code Style
- Match the style of existing code in the file being edited
- Do not add comments, docstrings, or type annotations to code you did not write
- Avoid over-engineering: prefer the simplest solution that satisfies the requirement

### Environment Files
- `.env` is git-ignored — never commit secrets or credentials
- Use `.env.example` (not git-ignored) to document required environment variables

### Dependencies
- Do not install packages without a clear reason tied to the task
- Prefer well-maintained packages with active communities
- Check for existing functionality before adding a new dependency

### Security
- Do not introduce SQL injection, XSS, command injection, or other OWASP Top 10 vulnerabilities
- Validate all external input at system boundaries (user input, external APIs)
- Never hardcode secrets, API keys, or passwords

## Updating This File

Keep CLAUDE.md current whenever significant project changes occur:
- New framework or language added
- Build/test commands change
- New architectural patterns adopted
- CI/CD pipeline added
- Important conventions established
