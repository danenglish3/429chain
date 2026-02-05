---
phase: 05-web-ui
plan: 02
subsystem: frontend
tags: [react, vite, typescript, tanstack-query, react-router, ui-scaffold]
type: execute
status: complete
requires:
  - 04-03 (stats and ratelimits API endpoints for Dashboard page)
provides:
  - ui/ directory with Vite + React 19 project
  - React Router with 4 declared routes (Dashboard, Providers, Chains, Test)
  - TanStack Query configured with 5s stale time
  - API client with sessionStorage auth header injection
  - Layout component with sidebar nav and API key input
  - Backend static file serving (serveStatic middleware)
  - SPA fallback for client-side routes
affects:
  - 05-03 (Providers page will plug into this scaffold)
  - 05-04 (Chains page will plug into this scaffold)
  - 05-05 (Dashboard page will plug into this scaffold)
  - 05-06 (Test page will plug into this scaffold)
tech-stack:
  added:
    - vite@^7.3.1 (dev server with HMR and build tool)
    - react@^19.2.4 (UI library)
    - react-dom@^19.2.4 (React DOM renderer)
    - react-router@^7 (client-side routing)
    - "@tanstack/react-query@^5" (data fetching and caching)
    - react-hook-form@^7 (form state management)
    - "@hookform/resolvers@^3" (form validation resolvers)
    - zod@^4.3.6 (schema validation, matches backend version)
    - "@dnd-kit/core@^6.3.1" (drag and drop primitives)
    - "@dnd-kit/sortable@^10.0.0" (sortable drag and drop)
    - "@dnd-kit/utilities@^3" (drag and drop utilities)
  patterns:
    - "Vite proxy pattern: /v1/* and /health proxy to backend during dev"
    - "serveStatic middleware pattern: backend serves ui/dist/ in production"
    - "SPA fallback pattern: non-API routes serve index.html for client-side routing"
    - "sessionStorage auth pattern: API key stored in sessionStorage, injected into fetch headers"
    - "Layout wrapper pattern: App renders Layout, Layout renders Outlet for child routes"
    - "CSS Modules pattern: scoped component styles with .module.css files"
key-files:
  created:
    - ui/package.json (frontend project manifest)
    - ui/tsconfig.json (TypeScript config for React + Vite)
    - ui/vite.config.ts (Vite config with proxy and build settings)
    - ui/index.html (SPA entry HTML)
    - ui/src/main.tsx (React entry point with router and query client)
    - ui/src/App.tsx (layout wrapper component)
    - ui/src/App.module.css (global CSS resets)
    - ui/src/lib/api.ts (centralized API client with auth)
    - ui/src/lib/queryKeys.ts (TanStack Query key constants)
    - ui/src/components/Layout.tsx (app shell with sidebar nav)
    - ui/src/components/Layout.module.css (layout styles)
    - ui/src/pages/Dashboard.tsx (placeholder page)
    - ui/src/pages/Providers.tsx (placeholder page)
    - ui/src/pages/Chains.tsx (placeholder page)
    - ui/src/pages/Test.tsx (placeholder page)
    - ui/src/vite-env.d.ts (CSS module type declarations)
  modified:
    - src/index.ts (added serveStatic imports and middleware)
decisions:
  - id: d037
    slug: vite-proxy-dev-backend
    summary: Vite dev server proxies /v1/* and /health to localhost:3429
    rationale: Avoid CORS issues during development, seamless dev experience
    alternatives: CORS headers on backend (more complex, error-prone)
  - id: d038
    slug: backend-serves-spa-static
    summary: Backend serves ui/dist/ static files and SPA fallback
    rationale: Single-server deployment, no separate static file server needed
    alternatives: Separate nginx/CDN (more infrastructure complexity)
  - id: d039
    slug: sessionStorage-api-key
    summary: API key stored in sessionStorage, cleared on 401 response
    rationale: Auto-clear on auth failure, survives page reloads within session
    alternatives: localStorage (persists across sessions, less secure), in-memory (lost on reload)
  - id: d040
    slug: css-modules-scoping
    summary: CSS Modules for component styles (.module.css files)
    rationale: Scoped styles, avoid global namespace pollution, type-safe class names
    alternatives: Global CSS (naming conflicts), styled-components (runtime overhead)
  - id: d041
    slug: placeholder-pages-now-implement-later
    summary: Create placeholder pages now, implement features in subsequent plans
    rationale: Router needs all routes declared upfront, pages will be fleshed out in 05-03 through 05-06
    alternatives: Create pages only when needed (requires router changes later)
metrics:
  duration: 12 minutes
  tasks: 2
  commits: 2
  files_created: 15
  files_modified: 1
completed: 2026-02-05
---

# Phase 05 Plan 02: React SPA Scaffold Summary

**One-liner:** Vite + React 19 SPA with React Router, TanStack Query, auth-injecting API client, sidebar layout shell, and backend static file serving.

## What Was Built

### Frontend Project Infrastructure
- **Vite + React 19 + TypeScript:** Complete ui/ directory with modern build tooling, HMR, and dev server
- **React Router v7:** Client-side routing with 4 declared routes (Dashboard, Providers, Chains, Test)
- **TanStack Query:** Data fetching and caching library configured with 5s stale time and retry logic
- **All Dependencies Installed:** react-hook-form, dnd-kit, zod (shared with backend), hookform resolvers

### API Client Layer
- **Centralized API Module:** `ui/src/lib/api.ts` with typed fetch wrapper
- **Auth Header Injection:** Reads API key from sessionStorage, adds `Authorization: Bearer <key>` to all requests
- **Error Handling:** Parses JSON errors, clears API key on 401 responses, throws typed errors
- **Typed API Functions:** All backend endpoints wrapped (config, providers, chains, stats, ratelimits, models, chat)
- **Query Keys:** Centralized query key constants for TanStack Query cache management

### Layout & UI Shell
- **Layout Component:** Sidebar navigation with 4 nav links (Dashboard, Providers, Chains, Test)
- **API Key Input:** Text input at top of sidebar with "Set" button, shows (set)/(not set) status indicator
- **CSS Modules Styling:** Dark sidebar (#1a1a2e), light main content (#fafafa), active link highlighting
- **Responsive Layout:** Flexbox-based 250px fixed sidebar + flex-grow main content area
- **Outlet Pattern:** App component wraps Layout, child routes render in main content via Outlet

### Backend Integration
- **Static File Serving:** `serveStatic` middleware serves ui/dist/ assets (JS, CSS, images)
- **SPA Fallback:** Non-API routes (not starting with /v1/ or /health) serve index.html
- **Dev Proxy:** Vite dev server proxies /v1/* and /health to backend on port 3429
- **Single-Server Deployment:** Backend serves both API and frontend, no separate static file server needed

### Placeholder Pages
- **Dashboard.tsx:** `<h1>Dashboard</h1>` (will show stats and charts in 05-05)
- **Providers.tsx:** `<h1>Providers</h1>` (will show provider config CRUD in 05-03)
- **Chains.tsx:** `<h1>Chains</h1>` (will show chain config with drag-and-drop in 05-04)
- **Test.tsx:** `<h1>Test</h1>` (will show chat completion test UI in 05-06)

## Implementation Notes

### Vite Configuration
- **Dev Server Port:** 5173 (Vite default)
- **Proxy Rules:** `/v1` and `/health` forward to `http://localhost:3429`
- **Build Output:** `ui/dist/` with emptyOutDir enabled
- **React Plugin:** @vitejs/plugin-react for JSX transform and HMR

### TypeScript Configuration
- **Target:** ES2022 with ESNext modules and bundler resolution
- **JSX:** react-jsx (automatic React import, no manual `import React`)
- **Strict Mode:** Enabled with skipLibCheck for faster compilation
- **Module Declarations:** vite-env.d.ts provides CSS module type definitions

### Router Setup
- **Browser Router:** createBrowserRouter with nested routes
- **Layout Route:** Top-level route wraps all pages with Layout component
- **Index Route:** `/` renders Dashboard component
- **Named Routes:** `/providers`, `/chains`, `/test` render respective page components
- **NavLink Active State:** Automatic active class for current route

### API Client Architecture
- **apiFetch<T> Generic:** Core fetch wrapper with type parameter for response shape
- **Auth Flow:** getApiKey() → add header → fetch → if 401 clearApiKey()
- **Content-Type Logic:** Automatically adds `application/json` for non-GET requests
- **Error Parsing:** Tries to extract `{ error: string }` from JSON, falls back to statusText

### CSS Modules Pattern
- **File Naming:** `*.module.css` for component styles
- **Import Pattern:** `import styles from './Layout.module.css'`
- **Class Application:** `className={styles.container}` for scoped class names
- **Type Safety:** vite-env.d.ts declares module types for TypeScript

## Decisions Made

**D037: Vite proxy for dev backend**
- Proxy /v1/* and /health to localhost:3429 during development
- Avoids CORS configuration complexity
- Seamless dev experience (single command starts UI)

**D038: Backend serves SPA static files**
- Backend uses serveStatic middleware for ui/dist/
- SPA fallback serves index.html for client-side routes
- Single-server deployment, no separate static file server needed

**D039: sessionStorage for API key**
- API key stored in sessionStorage, not localStorage
- Automatically cleared on 401 response
- Survives page reloads within session, cleared on browser close

**D040: CSS Modules for component styles**
- `.module.css` files for scoped component styles
- Avoids global namespace pollution
- Type-safe class names via TypeScript declarations

**D041: Placeholder pages created now**
- All routes declared upfront with placeholder components
- Pages will be implemented in subsequent plans (05-03 through 05-06)
- Router configuration stable, no changes needed later

## Deviations from Plan

None - plan executed exactly as written.

## Files Changed

### Created (15 files)
- `ui/package.json` - Frontend project manifest with scripts and dependencies
- `ui/tsconfig.json` - TypeScript config for React + Vite
- `ui/vite.config.ts` - Vite config with proxy and build settings
- `ui/index.html` - SPA entry HTML shell
- `ui/src/main.tsx` - React entry point with router and query client
- `ui/src/App.tsx` - Layout wrapper component
- `ui/src/App.module.css` - Global CSS resets
- `ui/src/lib/api.ts` - Centralized API client with auth
- `ui/src/lib/queryKeys.ts` - TanStack Query key constants
- `ui/src/components/Layout.tsx` - App shell with sidebar nav
- `ui/src/components/Layout.module.css` - Layout styles
- `ui/src/pages/Dashboard.tsx` - Placeholder page
- `ui/src/pages/Providers.tsx` - Placeholder page
- `ui/src/pages/Chains.tsx` - Placeholder page
- `ui/src/pages/Test.tsx` - Placeholder page
- `ui/src/vite-env.d.ts` - CSS module type declarations

### Modified (1 file)
- `src/index.ts` - Added serveStatic imports and middleware for frontend serving

## Testing & Verification

All verification criteria met:

1. ✅ `cd ui && npm run build` produces ui/dist/ with index.html + assets/
2. ✅ `cd ui && npx tsc --noEmit` passes (frontend TypeScript compiles)
3. ✅ `npx tsc --noEmit` (backend) passes
4. ✅ Layout component has nav links to all 4 pages
5. ✅ API client includes Authorization header from sessionStorage
6. ✅ Vite config proxies /v1 and /health to localhost:3429
7. ✅ Backend index.ts serves static files and has SPA fallback

## Integration Points

### Dependencies (requires)
- **04-03 Stats API:** Dashboard will fetch from /v1/stats/* endpoints
- **05-01 Admin API:** Providers and Chains pages will use /v1/admin/* endpoints

### Downstream Impact (affects)
- **05-03 Providers Page:** Will replace Providers.tsx placeholder with CRUD UI
- **05-04 Chains Page:** Will replace Chains.tsx placeholder with drag-and-drop chain editor
- **05-05 Dashboard Page:** Will replace Dashboard.tsx placeholder with stats and charts
- **05-06 Test Page:** Will replace Test.tsx placeholder with chat completion test UI

## Next Phase Readiness

**Phase 05 can continue:**
- ✅ UI scaffold complete and verified
- ✅ Router configured with all routes
- ✅ API client ready for data fetching
- ✅ Layout shell provides navigation and auth management
- ✅ Backend serves frontend static files

**Ready for:**
- Plan 05-03: Implement Providers page with add/edit/delete/reorder
- Plan 05-04: Implement Chains page with drag-and-drop entries
- Plan 05-05: Implement Dashboard with stats visualization
- Plan 05-06: Implement Test page with chat completion UI

No blockers. All subsequent plans can plug page components into this scaffold.
