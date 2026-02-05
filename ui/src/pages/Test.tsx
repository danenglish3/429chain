import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, getApiKey } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
import styles from './Test.module.css';

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface TestResult {
  response: ChatCompletionResponse;
  provider: string;
  attempts: number;
  latencyMs: number;
}

export default function Test() {
  const [prompt, setPrompt] = useState('');
  const [selectedChain, setSelectedChain] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const configQuery = useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
  });

  const testMutation = useMutation<TestResult, Error, void>({
    mutationFn: async () => {
      const startTime = performance.now();
      const apiKey = getApiKey();

      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedChain || 'default',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });

      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorJson = await response.json();
          if (errorJson.error) {
            errorMessage = errorJson.error;
          }
        } catch {
          // Fallback to statusText
        }
        throw new Error(errorMessage);
      }

      const provider = response.headers.get('X-429chain-Provider') || 'unknown';
      const attemptsHeader = response.headers.get('X-429chain-Attempts');
      const attempts = attemptsHeader ? parseInt(attemptsHeader, 10) : 1;

      const json = await response.json();

      return {
        response: json,
        provider,
        attempts,
        latencyMs,
      };
    },
  });

  const handleSend = () => {
    if (!prompt.trim()) return;
    testMutation.mutate();
  };

  const chains = configQuery.data?.chains || [];
  const result = testMutation.data;
  const error = testMutation.error;

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>Test Endpoint</h1>

      {/* Input Section */}
      <section className={styles.inputSection}>
        <div className={styles.controls}>
          <label className={styles.label}>
            Chain:
            <select
              className={styles.chainSelector}
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value)}
              disabled={testMutation.isPending}
            >
              <option value="">(default chain)</option>
              {chains.map((chain: any) => (
                <option key={chain.name} value={chain.name}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={isStreaming}
              onChange={(e) => setIsStreaming(e.target.checked)}
              disabled={true}
            />
            Stream <span className={styles.comingSoon}>(coming soon)</span>
          </label>
        </div>

        <textarea
          className={styles.promptInput}
          placeholder="Enter your message..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={testMutation.isPending}
          rows={5}
        />

        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={testMutation.isPending || !prompt.trim()}
        >
          {testMutation.isPending ? 'Sending...' : 'Send'}
        </button>
      </section>

      {/* Response Section */}
      {(result || error) && (
        <section className={styles.responseSection}>
          <h2 className={styles.sectionTitle}>Response</h2>

          {error && (
            <div className={styles.errorContainer}>
              <div className={styles.errorMessage}>
                Error: {error.message}
              </div>
            </div>
          )}

          {result && (
            <>
              <div className={styles.metadata}>
                <span className={styles.metadataItem}>
                  <strong>Served by:</strong> {result.provider}
                </span>
                <span className={styles.metadataItem}>
                  <strong>Attempts:</strong> {result.attempts}
                </span>
                <span className={styles.metadataItem}>
                  <strong>Latency:</strong> {result.latencyMs}ms
                </span>
                <span className={styles.metadataItem}>
                  <strong>Tokens:</strong> {result.response.usage.prompt_tokens} prompt + {result.response.usage.completion_tokens} completion = {result.response.usage.total_tokens} total
                </span>
              </div>

              <div className={styles.responseContent}>
                <pre>{result.response.choices[0]?.message?.content || '(no content)'}</pre>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
