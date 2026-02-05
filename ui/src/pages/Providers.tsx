import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
import ProviderForm from '../components/ProviderForm.js';
import styles from './Providers.module.css';

interface Provider {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl?: string;
}

export default function Providers() {
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
      setDeleteConfirmId(null);
      setDeleteError(null);
    },
    onError: (error: Error) => {
      setDeleteError(error.message);
    },
  });

  const handleDeleteClick = (id: string) => {
    if (deleteConfirmId === id) {
      // Second click - execute delete
      setDeleteError(null);
      deleteMutation.mutate(id);
    } else {
      // First click - show confirmation
      setDeleteConfirmId(id);
      setDeleteError(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmId(null);
    setDeleteError(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.config });
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading providers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Error loading providers: {error.message}</div>
      </div>
    );
  }

  const providers: Provider[] = data?.providers || [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Providers</h1>
        <button
          className={styles.addButton}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Add Provider'}
        </button>
      </div>

      {showForm && (
        <div className={styles.formSection}>
          <ProviderForm
            onSuccess={handleFormSuccess}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {providers.length === 0 ? (
        <div className={styles.empty}>No providers configured</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>API Key</th>
              <th>Base URL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id}>
                <td className={styles.idCell}>{provider.id}</td>
                <td>{provider.name}</td>
                <td>
                  <span className={`${styles.badge} ${styles[`badge${provider.type.replace(/-/g, '')}`]}`}>
                    {provider.type}
                  </span>
                </td>
                <td className={styles.apiKeyCell}>***</td>
                <td className={styles.baseUrlCell}>
                  {provider.baseUrl || <span className={styles.default}>default</span>}
                </td>
                <td>
                  <div className={styles.actions}>
                    {deleteConfirmId === provider.id ? (
                      <>
                        <button
                          className={styles.deleteButtonConfirm}
                          onClick={() => handleDeleteClick(provider.id)}
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending ? 'Deleting...' : 'Confirm?'}
                        </button>
                        <button
                          className={styles.cancelButton}
                          onClick={handleCancelDelete}
                          disabled={deleteMutation.isPending}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.deleteButton}
                        onClick={() => handleDeleteClick(provider.id)}
                      >
                        Delete
                      </button>
                    )}
                    {deleteError && deleteConfirmId === provider.id && (
                      <div className={styles.deleteError}>{deleteError}</div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
