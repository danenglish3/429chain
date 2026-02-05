# Phase 5: Web UI - Research

**Researched:** 2026-02-06
**Domain:** Admin dashboard SPA with React + Hono backend integration
**Confidence:** HIGH

## Summary

Research focused on building a browser-based admin dashboard as a React SPA served from the existing Hono/Node.js backend. The standard approach is Vite + React + TypeScript for the frontend, served as static files from a `dist/` folder alongside API routes, with React Router for client-side routing and TanStack Query for server state management.

The established pattern is to build a monolithic application where Hono serves both API endpoints (under `/v1/` and `/api/`) and the React SPA (catch-all route serving `index.html`). For this admin dashboard, the key technical challenges are CRUD operations with proper validation, drag-and-drop reordering for chains, real-time data updates for rate limits, and managing form state without introducing global state complexity.

**Primary recommendation:** Use Vite + React 19 + TypeScript with React Router v7 (library mode), TanStack Query v5 for server state, React Hook Form + Zod for forms, dnd-kit for drag-and-drop, and serve the built SPA from Hono using serveStatic middleware with a catch-all fallback route.

## Standard Stack

The established libraries/tools for building admin dashboards with React + Hono backend:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.2.4 | UI framework | Latest stable, battle-tested for admin UIs |
| react-dom | 19.2.4 | React renderer | Required for browser rendering |
| vite | 6.x (latest) | Build tool and dev server | Fast HMR, TypeScript support, standard for React in 2026 |
| react-router | 7.x | Client-side routing | Type-safe, smaller bundle than v6, non-breaking upgrade |
| @tanstack/react-query | 5.90.19+ | Server state management | Eliminates need for Redux, built-in caching and background refetch |
| typescript | 5.x | Type system | Already in project, essential for large admin UIs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-hook-form | 7.x | Form state management | All CRUD forms - lightweight, minimal re-renders |
| @hookform/resolvers | 3.x | Form validation adapters | Connect React Hook Form with Zod schemas |
| @dnd-kit/core | 6.3.1 | Drag-and-drop primitives | Chain reordering - accessible, performant |
| @dnd-kit/sortable | 10.0.0 | Sortable list utilities | Wraps @dnd-kit/core for lists with reordering |
| @dnd-kit/utilities | latest | Helper utilities | CSS transforms, coordinates for dnd-kit |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TanStack Query | Redux + RTK Query | Redux adds complexity and boilerplate for simple admin dashboards |
| React Router v7 | TanStack Router | TanStack Router is newer, less ecosystem maturity |
| dnd-kit | react-beautiful-dnd | react-beautiful-dnd is deprecated, no longer maintained |
| React Hook Form | Formik | Formik has more re-renders, larger bundle size |

**Installation:**
```bash
# Frontend dependencies (run in new ui/ directory)
npm create vite@latest ui -- --template react-ts
cd ui
npm install react-router @tanstack/react-query
npm install react-hook-form @hookform/resolvers
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Backend dependencies (already has Hono, add serve-static support)
# @hono/node-server already includes serveStatic support
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── api/                    # Existing backend
│   ├── routes/            # API routes (already exists)
│   └── middleware/        # Auth middleware (already exists)
├── ui/                     # NEW: Frontend React app (Vite project)
│   ├── src/
│   │   ├── pages/         # Page components (Provider, Chain, Dashboard, Test)
│   │   ├── components/    # Reusable UI components
│   │   ├── hooks/         # React hooks (useQuery wrappers)
│   │   ├── lib/           # API client, query keys, utilities
│   │   ├── App.tsx        # Root component with router
│   │   └── main.tsx       # Entry point
│   ├── index.html         # SPA HTML shell
│   ├── vite.config.ts     # Vite configuration
│   └── tsconfig.json      # Frontend TypeScript config
└── index.ts               # Backend entry (mount SPA routes)
```

### Pattern 1: Serve SPA from Hono Backend
**What:** Vite builds the React app to `ui/dist/`, Hono serves static files and falls back to `index.html` for client-side routes
**When to use:** Always - standard pattern for monolithic SPA + API server
**Example:**
```typescript
// Source: Hono GitHub discussions and documentation patterns
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

const app = new Hono();

// API routes first (already exists)
app.route('/v1', v1Routes);
app.route('/health', healthRoutes);

// Serve static assets (JS, CSS, images)
app.use('/assets/*', serveStatic({ root: './ui/dist' }));

// Catch-all: serve index.html for SPA client-side routing
app.get('*', serveStatic({ path: './ui/dist/index.html' }));
```

### Pattern 2: API Client with TanStack Query
**What:** Centralized fetch wrapper, typed query keys, React Query hooks for each endpoint
**When to use:** All data fetching in the UI - eliminates loading state management
**Example:**
```typescript
// Source: TanStack Query official docs v5
import { useQuery } from '@tanstack/react-query';

// Centralized API client
export const api = {
  async getProviders() {
    const res = await fetch('/v1/stats/providers', {
      headers: { 'Authorization': `Bearer ${getApiKey()}` }
    });
    if (!res.ok) throw new Error('Failed to fetch providers');
    return res.json();
  }
};

// Query keys in one place
export const queryKeys = {
  providers: ['providers'] as const,
  chains: ['chains'] as const,
  requests: (limit: number) => ['requests', limit] as const,
};

// Component usage
function ProvidersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.providers,
    queryFn: api.getProviders,
    refetchInterval: 5000, // Live updates every 5s
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>{/* Render providers */}</div>;
}
```

### Pattern 3: Forms with React Hook Form + Zod
**What:** useForm hook manages form state, zodResolver validates with existing Zod schemas, submit handler calls TanStack Query mutation
**When to use:** All CRUD forms (provider config, chain editor)
**Example:**
```typescript
// Source: React Hook Form + Zod integration guide 2026
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const providerSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(1),
  type: z.enum(['openai', 'anthropic', 'groq']),
});

function AddProviderForm() {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(providerSchema),
  });

  const mutation = useMutation({
    mutationFn: (data) => api.createProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
      <input {...register('id')} />
      {errors.id && <span>{errors.id.message}</span>}
      <button type="submit">Add Provider</button>
    </form>
  );
}
```

### Pattern 4: Drag-and-Drop with dnd-kit
**What:** DndContext wraps sortable list, useSortable hook on each item, onDragEnd updates order with mutation
**When to use:** Chain editor for reordering provider+model pairs
**Example:**
```typescript
// Source: dnd-kit sortable documentation
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function ChainEditor({ chain }) {
  const mutation = useMutation({
    mutationFn: (newOrder) => api.updateChainOrder(chain.name, newOrder),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => i.id === active.id);
      const newIndex = items.findIndex(i => i.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);
      mutation.mutate(reordered);
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={chain.entries} strategy={verticalListSortingStrategy}>
        {chain.entries.map(entry => <SortableItem key={entry.id} entry={entry} />)}
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ entry }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {entry.provider} - {entry.model}
    </div>
  );
}
```

### Pattern 5: Optimistic Updates for Immediate Feedback
**What:** UI updates immediately on user action, reverts if server mutation fails
**When to use:** High-frequency interactions like toggling settings, reordering (feels instant)
**Example:**
```typescript
// Source: TanStack Query optimistic updates documentation
const mutation = useMutation({
  mutationFn: api.updateChainOrder,
  onMutate: async (newOrder) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: queryKeys.chains });

    // Snapshot current value
    const previous = queryClient.getQueryData(queryKeys.chains);

    // Optimistically update
    queryClient.setQueryData(queryKeys.chains, newOrder);

    return { previous };
  },
  onError: (err, newOrder, context) => {
    // Revert on error
    queryClient.setQueryData(queryKeys.chains, context.previous);
  },
  onSettled: () => {
    // Always refetch after mutation
    queryClient.invalidateQueries({ queryKey: queryKeys.chains });
  },
});
```

### Anti-Patterns to Avoid
- **Global state for server data:** Don't use Redux or Context for data from API - TanStack Query handles caching, refetching, and sharing across components
- **Manual loading states:** Don't manage `isLoading` flags with useState - React Query provides loading/error states
- **Prop drilling for API data:** Don't pass fetched data down through components - use React Query hooks at the component level
- **Ignoring error boundaries:** Admin UIs need error boundaries to catch failed API calls and prevent white screens
- **Hand-rolling drag-and-drop:** Don't build custom drag logic - dnd-kit handles accessibility, touch, keyboard, and edge cases

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form validation | Custom validation + useState | React Hook Form + Zod resolver | Form state re-renders are complex, Zod schemas already exist in backend |
| Drag-and-drop | onMouseDown/onMouseMove handlers | dnd-kit | Accessibility (keyboard, screen readers), touch support, auto-scroll, collision detection |
| Data caching | useState + useEffect fetch | TanStack Query | Background refetching, request deduplication, stale-while-revalidate, error retry logic |
| Client-side routing | window.location or manual state | React Router v7 | Type safety, lazy loading, nested routes, URL state management |
| Live updates | setInterval + fetch | TanStack Query refetchInterval | Manages request state, cancels stale requests, handles errors consistently |
| API error handling | try/catch in every component | TanStack Query + Error Boundary | Centralized error UI, retry logic, offline detection |

**Key insight:** Admin dashboards have standard patterns that libraries have solved. Custom solutions for forms, drag-and-drop, or data fetching introduce maintenance burden and miss edge cases (keyboard nav, screen readers, stale data, network errors).

## Common Pitfalls

### Pitfall 1: Not Handling Stale Data
**What goes wrong:** User sees outdated data after mutations (e.g., creates provider, list doesn't update)
**Why it happens:** TanStack Query caches responses, mutations don't automatically invalidate related queries
**How to avoid:** Call `queryClient.invalidateQueries()` in mutation `onSuccess` to refetch affected queries
**Warning signs:** "I added X but don't see it in the list" - classic cache invalidation miss

### Pitfall 2: Loading Entire Datasets in Dropdowns
**What goes wrong:** Dropdown with 1000+ models/chains freezes UI, massive memory usage
**Why it happens:** Fetching all records when user only needs to select one
**How to avoid:** Use pagination (React Query's `useInfiniteQuery`), lazy loading, or server-side filtering. For admin dashboards with <100 items, full load is acceptable.
**Warning signs:** UI sluggishness when opening dropdowns, large network payloads

### Pitfall 3: Missing Server-Side Validation
**What goes wrong:** Client validation passes but server rejects request, user sees cryptic 400 error
**Why it happens:** Assuming client-side Zod validation is sufficient, not handling server errors in UI
**How to avoid:** Always display server error messages in forms using `mutation.error` from TanStack Query. Server MUST validate and return field-specific errors.
**Warning signs:** Generic "Request failed" messages, no indication of what field is invalid

### Pitfall 4: Overfetching on Every Render
**What goes wrong:** Network tab shows duplicate requests, API rate limits hit, UI flickers
**Why it happens:** Not using React Query's cache, putting useQuery inside components without stable query keys
**How to avoid:** Define query keys as constants, use React Query's default `staleTime` (0) and `gcTime` (5 minutes), or configure longer stale times for static data
**Warning signs:** Multiple identical network requests for same data, components re-rendering excessively

### Pitfall 5: No Undo for Destructive Actions
**What goes wrong:** User accidentally deletes provider/chain, no way to recover
**Why it happens:** Delete button triggers immediate mutation without confirmation or undo
**How to avoid:** Add confirmation dialogs for DELETE operations, implement soft deletes with "Recently Deleted" section, or show toast with "Undo" button using optimistic updates
**Warning signs:** User complaints about accidental deletions, support requests to recover data

### Pitfall 6: SPA Routes Not Falling Back to index.html
**What goes wrong:** Browser refresh on `/chains/my-chain` returns 404 from Hono
**Why it happens:** Hono doesn't have catch-all route to serve index.html for non-API paths
**How to avoid:** Place catch-all `app.get('*', serveStatic({ path: './ui/dist/index.html' }))` AFTER API routes but BEFORE 404 handler
**Warning signs:** Direct navigation or refresh on client-side routes fails with 404

### Pitfall 7: Not Testing Without JavaScript
**What goes wrong:** Drag-and-drop or forms completely break for users with accessibility tools
**Why it happens:** Assuming mouse-only interaction, not testing keyboard navigation
**How to avoid:** Use dnd-kit's built-in keyboard support, ensure forms have proper `<label>` tags, test with Tab navigation and Enter key
**Warning signs:** Complaints from users with disabilities, failing accessibility audits

## Code Examples

Verified patterns from official sources:

### Vite Dev Proxy to Backend API
```typescript
// Source: Vite official docs - server proxy configuration
// ui/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API requests to backend during development
      '/v1': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

### React Router v7 Setup (Library Mode SPA)
```typescript
// Source: React Router v7 official docs - SPA mode
// ui/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProvidersPage } from './pages/Providers';
import { ChainsPage } from './pages/Chains';
import { DashboardPage } from './pages/Dashboard';
import { TestPage } from './pages/Test';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000, // Consider data fresh for 5 seconds
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  { path: '/', element: <DashboardPage /> },
  { path: '/providers', element: <ProvidersPage /> },
  { path: '/chains', element: <ChainsPage /> },
  { path: '/test', element: <TestPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

### Mounting SPA in Hono Backend
```typescript
// Source: Hono Node.js static file serving patterns
// src/index.ts (add after existing route mounting)
import { serveStatic } from '@hono/node-server/serve-static';

// ... existing API route setup ...

// NEW: Serve frontend assets (CSS, JS, images)
app.use('/assets/*', serveStatic({ root: './ui/dist' }));

// NEW: SPA fallback - serve index.html for all non-API routes
// MUST come after API routes to avoid catching /v1/* paths
app.get('*', async (c, next) => {
  // Don't serve index.html for failed API requests
  if (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/health')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  return serveStatic({ path: './ui/dist/index.html' })(c, next);
});
```

### Error Boundary for API Failures
```typescript
// Source: React 19 error boundary patterns
// ui/src/components/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback
        ? this.props.fallback(this.state.error)
        : <div>Something went wrong: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

// Usage in router
<ErrorBoundary fallback={(err) => <ErrorPage error={err} />}>
  <RouterProvider router={router} />
</ErrorBoundary>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Create React App (CRA) | Vite | 2021-2023 | CRA unmaintained since 2022, Vite is now official React team recommendation |
| Redux for all state | TanStack Query for server state | 2020-2024 | Eliminates 80% of Redux boilerplate in data-driven apps |
| react-beautiful-dnd | dnd-kit | 2022-2024 | react-beautiful-dnd deprecated, dnd-kit smaller bundle and better accessibility |
| React Router v6 | React Router v7 | 2024-2025 | v7 adds type safety, smaller bundle, framework mode (optional) |
| Formik | React Hook Form | 2019-2023 | React Hook Form has better performance (fewer re-renders) |
| Class components | Function components + hooks | 2018-2020 | Hooks are standard since React 16.8, class components legacy |

**Deprecated/outdated:**
- **Create React App:** No longer maintained, Vite is replacement
- **react-beautiful-dnd:** Officially deprecated, use dnd-kit
- **Redux for server state:** TanStack Query is more efficient for API data
- **React Router v6 `<Routes>` JSX-only:** v7 adds `createBrowserRouter` with type generation

## Open Questions

Things that couldn't be fully resolved:

1. **Styling approach: CSS Modules vs Tailwind**
   - What we know: Both are viable in 2026. Tailwind has utility-first approach (fast, predictable bundle size), CSS Modules have traditional scoped CSS (easier for designers).
   - What's unclear: User preference not stated in requirements. Tailwind adds build step complexity and learning curve.
   - Recommendation: Default to CSS Modules for simplicity (no extra dependencies), revisit Tailwind if team requests utility-first approach. For an admin dashboard behind login, visual polish is secondary to functionality.

2. **Live rate limit updates: polling vs WebSocket**
   - What we know: TanStack Query's `refetchInterval` option provides polling. WebSockets add real-time push but require more backend infrastructure.
   - What's unclear: How "live" does rate limit display need to be? 5-second polling likely sufficient for admin monitoring.
   - Recommendation: Start with `refetchInterval: 5000` in React Query. If user requests instant updates, add WebSocket support in Phase 6+.

3. **Authentication: session cookies vs bearer tokens**
   - What we know: Backend has API key auth (bearer tokens). SPA needs to store key to call `/v1/*` endpoints.
   - What's unclear: Where to store API key? localStorage is vulnerable to XSS, sessionStorage lost on tab close.
   - Recommendation: Prompt user for API key on first visit, store in sessionStorage (balance security vs convenience). For production, consider adding session cookie auth in Phase 6+.

4. **Build output location: ui/dist vs dist/ui**
   - What we know: Vite outputs to `ui/dist` by default. Hono needs to serve from that path.
   - What's unclear: Should Vite output be moved to project-level `dist/` for cleaner deployment?
   - Recommendation: Keep Vite output at `ui/dist` for development simplicity. Deployment scripts can copy to `dist/ui` if needed, but serving from `ui/dist` works fine.

## Sources

### Primary (HIGH confidence)
- [TanStack Query React Docs v5](https://tanstack.com/query/latest/docs/framework/react/overview) - Server state management patterns
- [dnd-kit Documentation](https://docs.dndkit.com) - Drag-and-drop implementation
- [React Router v7 SPA Mode](https://reactrouter.com/how-to/spa) - Client-side routing setup
- [Vite Build Guide](https://vite.dev/guide/build) - Production build configuration
- [Hono Node.js Static Serving](https://hono.dev/docs/getting-started/nodejs) - Serving SPA from backend
- [React Hook Form + Zod Guide 2026](https://dev.to/marufrahmanlive/react-hook-form-with-zod-complete-guide-for-2026-1em1) - Form validation integration
- [React v19 Release](https://react.dev/blog/2024/12/05/react-19) - Current stable version features

### Secondary (MEDIUM confidence)
- [Hono GitHub Issue #1859](https://github.com/honojs/hono/issues/1859) - SPA fallback patterns (community discussion, verified with official docs)
- [React & CSS in 2026 Comparison](https://medium.com/@imranmsa93/react-css-in-2026-best-styling-approaches-compared-d5e99a771753) - Styling approaches (Medium post, cross-referenced with multiple sources)
- [REST API Best Practices - Stack Overflow](https://stackoverflow.blog/2020/03/02/best-practices-for-rest-api-design/) - CRUD endpoint patterns (established best practices)
- [An Expert's Guide to CRUD APIs](https://www.forestadmin.com/blog/an-experts-guide-to-crud-apis-designing-a-robust-one) - Admin UI pitfalls (domain expertise, verified with multiple sources)

### Tertiary (LOW confidence)
- [@dnd-kit/sortable npm page](https://www.npmjs.com/package/@dnd-kit/sortable) - Version numbers only (npm info can be outdated, verified package exists)
- [React Router v7 vs v6 upgrade articles](https://medium.com/@ignatovich.dm/react-router-7-vs-6-whats-new-and-should-you-upgrade-93bba58576a8) - Community opinion on upgrade path (marked for validation with official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified with official docs and npm, React 19 stable since Dec 2024, TanStack Query v5 active
- Architecture: HIGH - Patterns verified with official docs (Hono, React Router, TanStack Query), matches existing backend structure
- Pitfalls: MEDIUM - Based on multiple community sources and admin UI expertise articles, verified against official best practices but some are experience-based

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable ecosystem, React/Vite/TanStack mature projects)
