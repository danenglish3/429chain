import React, { useState } from 'react';
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
  errorMessage: string | null;
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
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.requests(100),
    queryFn: () => api.getRequests(100),
    refetchInterval: 5000,
  });

  const requests = data?.requests || [];

  const toggleRow = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
            <th className={styles.expandIcon}></th>
            <th>Time</th>
            <th>Chain</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Latency (ms)</th>
            <th>Status</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request: RequestLogRow, idx: number) => {
            const isExpanded = expandedRows.has(request.id);
            return (
              <React.Fragment key={request.id}>
                <tr onClick={() => toggleRow(request.id)} style={{ cursor: 'pointer' }}>
                  <td className={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</td>
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
                  <td>
                    {request.attempts > 1 ? (
                      <span className={styles.waterfallBadge}>{request.attempts}x</span>
                    ) : (
                      <span>{request.attempts}</span>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className={styles.expandedRow}>
                    <td colSpan={9}>
                      <div className={styles.expandedContent}>
                        {request.errorMessage && (
                          <div className={styles.errorNote}>
                            {request.errorMessage}
                          </div>
                        )}
                        {request.attempts > 1 && !request.errorMessage && (
                          <div className={styles.waterfallNote}>
                            This request was served after {request.attempts - 1} waterfall attempt(s)
                          </div>
                        )}
                        <div className={styles.detailGrid}>
                          <div className={styles.detailItem}>
                            <div className={styles.detailLabel}>PROMPT TOKENS</div>
                            <div className={styles.detailValue}>{request.promptTokens.toLocaleString()}</div>
                          </div>
                          <div className={styles.detailItem}>
                            <div className={styles.detailLabel}>COMPLETION TOKENS</div>
                            <div className={styles.detailValue}>{request.completionTokens.toLocaleString()}</div>
                          </div>
                          <div className={styles.detailItem}>
                            <div className={styles.detailLabel}>TOTAL TOKENS</div>
                            <div className={styles.detailValue}>{request.totalTokens.toLocaleString()}</div>
                          </div>
                          <div className={styles.detailItem}>
                            <div className={styles.detailLabel}>ATTEMPTS</div>
                            <div className={styles.detailValue}>{request.attempts}</div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
