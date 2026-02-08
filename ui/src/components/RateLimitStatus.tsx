import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
import styles from './RateLimitStatus.module.css';

interface QuotaInfo {
  remainingRequests: number | null;
  remainingTokens: number | null;
  resetRequestsMs: number | null;
  resetTokensMs: number | null;
  lastUpdated: number;
}

interface RateLimitEntry {
  provider: string;
  model: string;
  status: 'available' | 'tracking' | 'exhausted';
  cooldownUntil: number | null;
  reason: string | null;
  quota: QuotaInfo | null;
}

interface ActiveEntry {
  chain: string;
  provider: string;
  model: string;
}

function getStatusBadgeClass(status: string): string {
  if (status === 'available') return styles.statusAvailable;
  if (status === 'tracking') return styles.statusTracking;
  if (status === 'exhausted') return styles.statusExhausted;
  return '';
}

function formatCooldown(cooldownUntil: number): string {
  const now = Date.now();
  const remaining = Math.max(0, cooldownUntil - now);
  const seconds = Math.ceil(remaining / 1000);

  if (seconds > 60) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }
  return `${seconds}s`;
}

export default function RateLimitStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.rateLimits,
    queryFn: api.getRateLimits,
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  const rateLimits = data?.ratelimits || [];
  const activeEntries: ActiveEntry[] = data?.activeEntries || [];

  if (isLoading) {
    return <div className={styles.loading}>Loading rate limit status...</div>;
  }

  if (error) {
    return (
      <div className={styles.error}>
        Error loading rate limits: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  if (rateLimits.length === 0) {
    return <div className={styles.empty}>No rate limit data available</div>;
  }

  return (
    <div className={styles.container}>
      {activeEntries.length > 0 && (
        <div className={styles.activeSection}>
          {activeEntries.map((entry: ActiveEntry) => (
            <div key={entry.chain} className={styles.activeCard}>
              <div className={styles.activeLabel}>ACTIVE ON {entry.chain.toUpperCase()}</div>
              <div className={styles.activeModel}>
                <span className={styles.provider}>{entry.provider}</span>
                <span className={styles.separator}>/</span>
                <span className={styles.model}>{entry.model}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.grid}>
        {rateLimits.map((entry: RateLimitEntry, index: number) => (
          <div key={`${entry.provider}-${entry.model}-${index}`} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.providerModel}>
                <span className={styles.provider}>{entry.provider}</span>
                <span className={styles.separator}>/</span>
                <span className={styles.model}>{entry.model}</span>
              </div>
              <span className={`${styles.statusBadge} ${getStatusBadgeClass(entry.status)}`}>
                {entry.status}
              </span>
            </div>

            {entry.status === 'exhausted' && entry.cooldownUntil && (
              <div className={styles.cooldown}>
                Cooldown: <span className={styles.cooldownTimer}>{formatCooldown(entry.cooldownUntil)}</span>
              </div>
            )}

            {entry.status === 'tracking' && entry.quota && (
              <div className={styles.quota}>
                {entry.quota.remainingRequests !== null && (
                  <div className={styles.quotaItem}>
                    Remaining requests: <span className={styles.quotaValue}>{entry.quota.remainingRequests.toLocaleString()}</span>
                  </div>
                )}
                {entry.quota.remainingTokens !== null && (
                  <div className={styles.quotaItem}>
                    Remaining tokens: <span className={styles.quotaValue}>{entry.quota.remainingTokens.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {entry.reason && entry.status === 'exhausted' && (
              <div className={styles.reason}>{entry.reason}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
