import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
import styles from './RequestLog.module.css';

interface RequestLogRow {
  id: number;
  timestamp: number;
  chainName: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  httpStatus: number;
  attempts: number;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return styles.statusSuccess;
  if (status >= 400 && status < 500) return styles.statusWarning;
  if (status >= 500) return styles.statusError;
  return '';
}

export default function RequestLog() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.requests(100),
    queryFn: () => api.getRequests(100),
  });

  const requests = data?.requests || [];

  if (isLoading) {
    return <div className={styles.loading}>Loading request log...</div>;
  }

  if (error) {
    return (
      <div className={styles.error}>
        Error loading requests: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  if (requests.length === 0) {
    return <div className={styles.empty}>No requests logged yet</div>;
  }

  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Chain</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Latency (ms)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request: RequestLogRow) => (
            <tr key={request.id}>
              <td className={styles.timeCell}>{formatTime(request.timestamp)}</td>
              <td>{request.chainName}</td>
              <td>{request.providerId}</td>
              <td className={styles.modelCell}>{request.model}</td>
              <td className={styles.numberCell}>{request.totalTokens.toLocaleString()}</td>
              <td className={styles.numberCell}>{request.latencyMs.toLocaleString()}</td>
              <td>
                <span className={`${styles.statusBadge} ${getStatusColor(request.httpStatus)}`}>
                  {request.httpStatus}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
