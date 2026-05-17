# Website

React + Vite + Hono + Tailwind + Cloudflare Workers

<preflight>
1. First ask relevent questions like Purpose (landing/portfolio/SaaS/e-commerce), Need templates(this is MUST to confirm), industry, style, sections needed, features etc. 
2. If user wants to see templates(assume YES if not answered above), use show_templates tool with relevent search `query` and `type: website` to show templates to user. This should be individual call never merge this request with anything else like the above step.
3. Form a plan and present it to the user. The plan should include your assumptions about what's being built, which parts of the stack are involved (frontend, API, database, routing), what the visual direction is for any UI work, and what files you expect to create or modify. Write a super detailed outline.md file about the site and specially on the design guidelines which you can refer for consistent theme. If brand information is available, you must follow the brand colors, fonts, logo, and overall vibe. The template is only for visual style and layout. 

State these as decisions, not questions. The user will correct what's wrong and ignore what's right.

Do not start implementation until the user has seen the plan and either approved or adjusted it.
</preflight>

## Project Structure

- `src/web/` — React frontend: pages, components, styles, hooks
- `src/api/` — Hono API server (`/api/*`), database schema and migrations
- `public/` — Static assets (favicon, og-image, logo)


## Quick Start

```bash
# Install dependencies
bun install

# Generate types and run migrations
bun cf-typegen
bun db:generate
bun db:migrate

# Start dev server
bun dev
```

## shadcn/ui

Add components you need, customize them however you want.

```bash
bun x shadcn@latest add button card dialog
```

Components land in `src/web/components/ui/`, import with `@/components/ui/button`.

```tsx
import { Button } from "@/components/ui/button"

<Button variant="outline">Click me</Button>
```

## Routing

Client-side routing uses [wouter](https://github.com/molefrog/wouter). Add routes in `src/web/app.tsx`:

```tsx
import { Route, Switch } from "wouter";

<Switch>
  <Route path="/" component={Home} />
  <Route path="/about" component={About} />
</Switch>
```

## Database

Uses [Drizzle ORM](https://orm.drizzle.team/) with Cloudflare D1.

```bash
bun db:generate       # Generate migrations from schema
bun db:migrate        # Apply migrations locally
```

Schema is in `src/api/database/schema.ts`, migrations in `src/api/migrations/`.

## API

Backend uses [Hono](https://hono.dev/) on Cloudflare Workers. All routes are under `/api/*` in `src/api/index.ts`.

```ts
app.get('/api/hello', (c) => c.json({ message: 'Hello' }));
```

## Best Practices

### Code

- Functional style — use `const`, early returns, avoid nesting and `let`
- Prefer clarity over cleverness — no nested ternaries, no dense one-liners, explicit beats compact
- Import directly from modules — avoid barrel files for bundle size
- Parallelize async work with `Promise.all()` — never chain independent awaits
- Use existing libraries and shadcn/ui components over custom implementations

### React

- Compose with `children` and compound components — avoid boolean prop sprawl
- React 19 — no `forwardRef`, use `use()` instead of `useContext()`
- Derive state during render, not in effects — avoid unnecessary `useEffect`
- Use `startTransition` for non-urgent UI updates
- Memoize expensive computations, not simple primitives — don't over-optimize
- Keep components small and focused — one responsibility per file
- Fetch API data with `fetch("/api/...")` — no extra HTTP libraries needed

<design_guidelines>
Before writing UI code, document the design direction in outline.md with fonts, colors, spacing, and visual style. Reference this file for all UI work to maintain consistency.

## Typography
- Use distinctive, characterful fonts — never Inter, Roboto, Arial, or system fonts
- Pair a display font with a refined body font
- Create hierarchy through size contrast and weight
- Use generous line height; text should never feel crowded

## Color
- Commit to a dominant color with sharp accents
- Use CSS variables and Tailwind for theming
- Accents appear sparingly for emphasis, not decoration

## Layout
- Break expectations: asymmetric layouts, overlapping elements, grid-breaking moments
- Use generous negative space or controlled density intentionally

## Backgrounds
- Create atmosphere with gradient meshes, noise textures, geometric patterns, or layered transparencies
- Match the effect to the overall aesthetic

## Motion
- Prioritize one well-orchestrated page load with staggered reveals (animation-delay)
- Focus on high-impact moments over scattered micro-interactions
- Use CSS-only solutions for HTML, Motion library for React

## Anti-patterns to avoid (otherwise it will look really bad)
- Purple gradients on white backgrounds
- Predictable card grids with rounded corners
- Cookie-cutter layouts lacking context-specific character
- Overused fonts (Inter, Space Grotesk, Roboto)

</design_guidelines>

## Config

`website.config.json` contains the site name, description, and URL — use it as the source of truth for site-wide values.

## Other tools you can use

Use web_search tool to get any information, or images you need for the website. 

ALWAYS first try to search and find images instead of generating in the first attempt itself. 

You can mb(mini browser) tool to navigate through website to find informations, images, logo which you are not able to get from web_search tool. ALWAYS use mb(mini browser) command if user mentions some website to take reference from because web_search can give you outdated results. 