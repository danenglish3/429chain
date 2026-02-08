import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
import StatsCard from '../components/StatsCard.js';
import RequestLog from '../components/RequestLog.js';
import RateLimitStatus from '../components/RateLimitStatus.js';
import styles from './Dashboard.module.css';

interface ProviderUsage {
  providerId: string;
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastRequestTimestamp: number | null;
}

interface ChainUsage {
  chainName: string;
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastRequestTimestamp: number | null;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

export default function Dashboard() {
  const summaryStatsQuery = useQuery({
    queryKey: queryKeys.summaryStats,
    queryFn: api.getSummaryStats,
    refetchInterval: 5000,
  });

  const providerStatsQuery = useQuery({
    queryKey: queryKeys.providerStats,
    queryFn: api.getProviderStats,
  });

  const chainStatsQuery = useQuery({
    queryKey: queryKeys.chainStats,
    queryFn: api.getChainStats,
  });

  const summaryStats = summaryStatsQuery.data?.summary || { totalRequests: 0, waterfallRequests: 0, avgLatencyMs: 0 };
  const providerStats = providerStatsQuery.data?.providers || [];
  const chainStats = chainStatsQuery.data?.chains || [];

  const isLoading = summaryStatsQuery.isLoading || providerStatsQuery.isLoading || chainStatsQuery.isLoading;
  const error = summaryStatsQuery.error || providerStatsQuery.error || chainStatsQuery.error;

  const waterfallPercent = summaryStats.totalRequests > 0
    ? ((summaryStats.waterfallRequests / summaryStats.totalRequests) * 100).toFixed(1)
    : '0.0';

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>Dashboard</h1>

      {/* Section 0: Overview */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Overview</h2>

        {isLoading && <div className={styles.loading}>Loading usage data...</div>}

        {error && (
          <div className={styles.error}>
            Error loading usage data: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        {!isLoading && !error && (
          <div className={styles.overviewGrid}>
            <StatsCard
              title="Total Requests"
              value={formatNumber(summaryStats.totalRequests)}
              subtitle=""
            />
            <StatsCard
              title="Waterfalled"
              value={formatNumber(summaryStats.waterfallRequests)}
              subtitle={`${waterfallPercent}% of requests`}
            />
            <StatsCard
              title="Avg Latency"
              value={`${summaryStats.avgLatencyMs}ms`}
              subtitle=""
            />
          </div>
        )}
      </section>

      {/* Section 1: Usage Summary */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Usage Summary</h2>

        {isLoading && <div className={styles.loading}>Loading usage data...</div>}

        {error && (
          <div className={styles.error}>
            Error loading usage data: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        {!isLoading && !error && providerStats.length === 0 && chainStats.length === 0 && (
          <div className={styles.emptyState}>No usage data yet</div>
        )}

        {!isLoading && !error && (providerStats.length > 0 || chainStats.length > 0) && (
          <div className={styles.statsGrid}>
            {providerStats.map((provider: ProviderUsage) => (
              <StatsCard
                key={provider.providerId}
                title={`Provider: ${provider.providerId}`}
                value={formatNumber(provider.totalRequests)}
                subtitle={`${formatNumber(provider.totalTokens)} tokens`}
              />
            ))}

            {chainStats.map((chain: ChainUsage) => (
              <StatsCard
                key={chain.chainName}
                title={`Chain: ${chain.chainName}`}
                value={formatNumber(chain.totalRequests)}
                subtitle={`${formatNumber(chain.totalTokens)} tokens`}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Request Log */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Requests</h2>
        <RequestLog />
      </section>

      {/* Section 3: Rate Limit Status */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Rate Limit Status</h2>
        <RateLimitStatus />
      </section>
    </div>
  );
}
