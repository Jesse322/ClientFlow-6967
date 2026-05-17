# Fix: Topbar Title Doesn't Match Current Page

## Problem
The topbar shows a static/stale title (e.g. "Dashboard") regardless of which page the user is on.

## Root Cause
`topbar.tsx` either hardcodes the title or reads it once on mount without reacting to route changes.

## Fix Plan

### Step 1 — Read current route in Topbar
Use `useLocation()` from `react-router-dom` inside `topbar.tsx` to get the current pathname on every navigation.

### Step 2 — Map pathname → page title
Add a simple lookup map inside `topbar.tsx`:

```ts
const PAGE_TITLES: Record<string, string> = {
  "/":             "Dashboard",
  "/compliance":   "Compliance",
  "/clients":      "Clients",
  "/reports":      "Reports",
  // ...add any other routes
};
```

Derive title with: `PAGE_TITLES[pathname] ?? "Dashboard"`

### Step 3 — Render derived title
Replace whatever static value is currently rendered in the topbar with the derived title.

### Files changed
- `src/web/components/layout/topbar.tsx` — only file that needs to change

### No changes needed to
- `app.tsx` — no prop drilling required
- Any page component — `PageHeader` titles are already correct

## Risk
Low. Self-contained change to one component, no data layer involved.
