---
phase: quick
plan: 011
type: execute
wave: 1
depends_on: []
files_modified:
  - src/persistence/aggregator.ts
  - src/api/routes/stats.ts
  - ui/src/lib/api.ts
  - ui/src/lib/queryKeys.ts
  - ui/src/pages/Dashboard.tsx
  - ui/src/pages/Dashboard.module.css
  - ui/src/components/RequestLog.tsx
  - ui/src/components/RequestLog.module.css
autonomous: true

must_haves:
  truths:
    - "Dashboard shows waterfall summary stats (total requests, waterfalled count + %, avg latency)"
    - "Request log rows with attempts > 1 have a visual waterfall badge"
    - "Clicking a request row expands to show token breakdown and waterfall info"
    - "Request log auto-refreshes every 5 seconds"
  artifacts:
    - path: "src/persistence/aggregator.ts"
      provides: "getSummaryStats() method"
      contains: "getSummaryStats"
    - path: "src/api/routes/stats.ts"
      provides: "GET /summary endpoint"
      contains: "/summary"
    - path: "ui/src/components/RequestLog.tsx"
      provides: "Expandable rows with waterfall badge and auto-refresh"
      contains: "expandedRows"
  key_links:
    - from: "ui/src/pages/Dashboard.tsx"
      to: "/v1/stats/summary"
      via: "api.getSummaryStats()"
      pattern: "getSummaryStats"
    - from: "ui/src/components/RequestLog.tsx"
      to: "expandedRows state"
      via: "useState Set<number>"
      pattern: "expandedRows"
---

<objective>
Enhance the dashboard with waterfall stats, expandable request rows showing attempt details and token breakdown, and auto-refresh on the request log.

Purpose: Give visibility into waterfall behavior (how often requests cascade through the provider chain) and make the request log more useful with expandable detail rows.
Output: Updated backend endpoint + enhanced Dashboard and RequestLog components.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/persistence/aggregator.ts
@src/api/routes/stats.ts
@ui/src/lib/api.ts
@ui/src/lib/queryKeys.ts
@ui/src/pages/Dashboard.tsx
@ui/src/pages/Dashboard.module.css
@ui/src/components/RequestLog.tsx
@ui/src/components/RequestLog.module.css
@ui/src/components/StatsCard.tsx
@ui/src/pages/Test.tsx (reference for expandable row pattern - lines 55-64 for expandedRows/toggleRow, lines 273-325 for expand/collapse rendering)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add summary stats backend endpoint</name>
  <files>
    src/persistence/aggregator.ts
    src/api/routes/stats.ts
    ui/src/lib/api.ts
    ui/src/lib/queryKeys.ts
  </files>
  <action>
    1. In `src/persistence/aggregator.ts`:
       - Add a new interface `SummaryStats` with fields: `totalRequests: number`, `waterfallRequests: number`, `avgLatencyMs: number`
       - In the constructor, add a new prepared statement `getSummaryStatsStmt`:
         ```sql
         SELECT
           COUNT(*) as totalRequests,
           SUM(CASE WHEN attempts > 1 THEN 1 ELSE 0 END) as waterfallRequests,
           ROUND(AVG(latency_ms)) as avgLatencyMs
         FROM request_logs
         ```
       - Add method `getSummaryStats(): SummaryStats` that runs the statement and returns the result (with fallback defaults of 0 if no rows)

    2. In `src/api/routes/stats.ts`:
       - Add a new route `GET /summary` that calls `aggregator.getSummaryStats()` and returns JSON: `{ summary: SummaryStats }`
       - Place it BEFORE the parameterized routes (before `/providers/:providerId`) to avoid route conflicts

    3. In `ui/src/lib/queryKeys.ts`:
       - Add `summaryStats: ['summaryStats'] as const`

    4. In `ui/src/lib/api.ts`:
       - Add `getSummaryStats: () => apiFetch<{ summary: { totalRequests: number; waterfallRequests: number; avgLatencyMs: number } }>('/v1/stats/summary')`
  </action>
  <verify>
    Run `npx tsx -e "console.log('ts ok')"` to sanity check. Then verify the backend compiles:
    ```
    cd C:\Users\danen\Documents\429chain && npx tsc --noEmit
    ```
    If the project uses a different typecheck command, check package.json scripts.
  </verify>
  <done>
    - `GET /v1/stats/summary` returns `{ summary: { totalRequests, waterfallRequests, avgLatencyMs } }`
    - Frontend API client and query key ready for consumption
  </done>
</task>

<task type="auto">
  <name>Task 2: Dashboard summary cards + expandable request rows + auto-refresh</name>
  <files>
    ui/src/pages/Dashboard.tsx
    ui/src/pages/Dashboard.module.css
    ui/src/components/RequestLog.tsx
    ui/src/components/RequestLog.module.css
  </files>
  <action>
    **Dashboard.tsx - Add summary stats section:**

    1. Import `api.getSummaryStats` and `queryKeys.summaryStats`
    2. Add a `useQuery` for summary stats with `refetchInterval: 5000` (same auto-refresh cadence)
    3. ABOVE the existing "Usage Summary" section (provider/chain cards), add a new section "Overview" with 3 `StatsCard` components in a row:
       - "Total Requests" showing `summary.totalRequests`
       - "Waterfalled" showing `summary.waterfallRequests` with subtitle showing percentage: `${((waterfallRequests / totalRequests) * 100).toFixed(1)}% of requests` (handle division by zero - show "0%" if totalRequests is 0)
       - "Avg Latency" showing `${summary.avgLatencyMs}ms`
    4. Keep existing provider/chain cards section unchanged below it

    **Dashboard.module.css:**
    - Add `.overviewGrid` style: `display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 8px;`

    **RequestLog.tsx - Add expandable rows, waterfall badge, auto-refresh:**

    1. Add `refetchInterval: 5000` to the existing `useQuery` options (auto-refresh)

    2. Add expandable row state (same pattern as Test.tsx):
       ```tsx
       const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
       const toggleRow = (idx: number) => {
         setExpandedRows((prev) => {
           const next = new Set(prev);
           if (next.has(idx)) next.delete(idx);
           else next.add(idx);
           return next;
         });
       };
       ```

    3. Modify the table structure:
       - Add a narrow first `<th>` (empty header, ~30px width) for the expand icon column
       - After the Status column, add an "Attempts" column header

    4. Modify each table row (`<tr>`):
       - Make the `<tr>` clickable: `onClick={() => toggleRow(idx)}` with `style={{ cursor: 'pointer' }}`
       - First `<td>`: expand icon - show `\u25BC` (down arrow) if expanded, `\u25B6` (right arrow) if collapsed
       - After Status `<td>`, add Attempts `<td>`:
         - If `request.attempts > 1`: render a waterfall badge span with CSS class `.waterfallBadge` showing text like "2x" or "3x" (the attempts count followed by "x")
         - If `request.attempts === 1`: just show "1"

    5. After each `<tr>`, conditionally render an expanded detail row when `expandedRows.has(idx)`:
       ```tsx
       {expandedRows.has(idx) && (
         <tr className={styles.expandedRow}>
           <td colSpan={9} className={styles.expandedContent}>
             <div className={styles.detailGrid}>
               <div className={styles.detailItem}>
                 <span className={styles.detailLabel}>Prompt Tokens</span>
                 <span className={styles.detailValue}>{request.promptTokens.toLocaleString()}</span>
               </div>
               <div className={styles.detailItem}>
                 <span className={styles.detailLabel}>Completion Tokens</span>
                 <span className={styles.detailValue}>{request.completionTokens.toLocaleString()}</span>
               </div>
               <div className={styles.detailItem}>
                 <span className={styles.detailLabel}>Total Tokens</span>
                 <span className={styles.detailValue}>{request.totalTokens.toLocaleString()}</span>
               </div>
               <div className={styles.detailItem}>
                 <span className={styles.detailLabel}>Attempts</span>
                 <span className={styles.detailValue}>{request.attempts}</span>
               </div>
               {request.attempts > 1 && (
                 <div className={styles.waterfallNote}>
                   This request was served after {request.attempts - 1} waterfall attempt(s)
                 </div>
               )}
             </div>
           </td>
         </tr>
       )}
       ```

    **RequestLog.module.css - Add styles for expandable rows and waterfall badge:**

    Add these new CSS classes:

    ```css
    .expandIcon {
      width: 30px;
      text-align: center;
      color: #888888;
      font-size: 10px;
      user-select: none;
    }

    .waterfallBadge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      background-color: #fff3cd;
      color: #856404;
      font-family: 'Courier New', monospace;
    }

    .expandedRow {
      background-color: #f8f9fa !important;
    }

    .expandedRow:hover {
      background-color: #f8f9fa !important;
    }

    .expandedContent {
      padding: 16px 16px 16px 46px !important;
    }

    .detailGrid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }

    .detailItem {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .detailLabel {
      font-size: 11px;
      font-weight: 500;
      color: #888888;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .detailValue {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
      font-family: 'Courier New', monospace;
    }

    .waterfallNote {
      grid-column: 1 / -1;
      margin-top: 4px;
      padding: 8px 12px;
      background-color: #fff3cd;
      border-radius: 4px;
      color: #856404;
      font-size: 13px;
    }
    ```

    Important: When mapping over requests, use `requests.map((request: RequestLogRow, idx: number)` to have the index for expandedRows. Use React Fragment (`<>...</>`) or `<React.Fragment key={request.id}>` to wrap the main row + expanded row together since they are sibling `<tr>` elements. Import `useState` from React at the top.
  </action>
  <verify>
    1. Run frontend typecheck: `cd C:\Users\danen\Documents\429chain\ui && npx tsc --noEmit`
    2. Run frontend build: `cd C:\Users\danen\Documents\429chain\ui && npm run build`
    3. Both should succeed with no errors.
  </verify>
  <done>
    - Dashboard shows "Overview" section with 3 summary stats cards (Total Requests, Waterfalled with %, Avg Latency) above existing provider/chain cards
    - RequestLog table has expand/collapse icons, an Attempts column with waterfall badge (yellow pill) for attempts > 1
    - Clicking a row expands to show prompt/completion/total token breakdown and waterfall note
    - Request log auto-refreshes every 5 seconds
    - All existing functionality preserved (provider/chain cards, rate limit status)
  </done>
</task>

</tasks>

<verification>
1. Backend typecheck passes: `cd C:\Users\danen\Documents\429chain && npx tsc --noEmit`
2. Frontend build succeeds: `cd C:\Users\danen\Documents\429chain\ui && npm run build`
3. Start the server and verify:
   - `GET /v1/stats/summary` returns valid JSON with totalRequests, waterfallRequests, avgLatencyMs
   - Dashboard page shows overview stats cards at the top
   - Request log table has expand icons and Attempts column
   - Rows with attempts > 1 show yellow waterfall badge
   - Clicking a row expands to show token breakdown
   - Request log updates automatically (watch for new requests appearing without manual refresh)
</verification>

<success_criteria>
- Summary stats endpoint returns correct waterfall counts from request_logs
- Dashboard overview cards display total requests, waterfall count with percentage, and avg latency
- Request rows are expandable with token breakdown details
- Waterfalled requests (attempts > 1) have a visible yellow badge
- Expanded waterfall rows show "served after N waterfall attempt(s)" note
- Request log auto-refreshes every 5 seconds
- No regressions to existing dashboard functionality
</success_criteria>

<output>
After completion, create `.planning/quick/011-dashboard-enhancements/011-SUMMARY.md`
</output>
