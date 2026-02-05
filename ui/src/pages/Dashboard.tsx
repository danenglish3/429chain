import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
// import StatsCard from '../components/StatsCard.js'; // TODO: implement in plan 05-04
// import RequestLog from '../components/RequestLog.js'; // TODO: implement in plan 05-04
// import RateLimitStatus from '../components/RateLimitStatus.js'; // TODO: implement in plan 05-04
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
  const providerStatsQuery = useQuery({
    queryKey: queryKeys.providerStats,
    queryFn: api.getProviderStats,
  });

  const chainStatsQuery = useQuery({
    queryKey: queryKeys.chainStats,
    queryFn: api.getChainStats,
  });

  const providerStats = providerStatsQuery.data?.providers || [];
  const chainStats = chainStatsQuery.data?.chains || [];

  const isLoading = providerStatsQuery.isLoading || chainStatsQuery.isLoading;
  const error = providerStatsQuery.error || chainStatsQuery.error;

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>Dashboard</h1>

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
            {/* TODO: implement StatsCard in plan 05-04 */}
            {providerStats.map((provider: ProviderUsage) => (
              <div key={provider.providerId}>
                <strong>Provider: {provider.providerId}</strong>
                <div>{formatNumber(provider.totalRequests)} requests</div>
                <div>{formatNumber(provider.totalTokens)} tokens</div>
              </div>
            ))}

            {chainStats.map((chain: ChainUsage) => (
              <div key={chain.chainName}>
                <strong>Chain: {chain.chainName}</strong>
                <div>{formatNumber(chain.totalRequests)} requests</div>
                <div>{formatNumber(chain.totalTokens)} tokens</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Request Log */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Requests</h2>
        {/* TODO: implement RequestLog in plan 05-04 */}
        <div>RequestLog component coming soon</div>
      </section>

      {/* Section 3: Rate Limit Status */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Rate Limit Status</h2>
        {/* TODO: implement RateLimitStatus in plan 05-04 */}
        <div>RateLimitStatus component coming soon</div>
      </section>
    </div>
  );
}
