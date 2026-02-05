import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
// import ChainEditor from '../components/ChainEditor.js'; // TODO: implement in plan 05-05
import styles from './Chains.module.css';

interface Chain {
  name: string;
  entries: Array<{ provider: string; model: string }>;
}

interface Provider {
  id: string;
  name: string;
  type: string;
}

interface Config {
  providers: Provider[];
  chains: Chain[];
  settings: {
    defaultChain: string;
  };
}

export default function Chains() {
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Create form state
  const [newChainName, setNewChainName] = useState('');
  const [newChainProvider, setNewChainProvider] = useState('');
  const [newChainModel, setNewChainModel] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
  });

  const createMutation = useMutation({
    mutationFn: ({ name, entries }: { name: string; entries: Array<{ provider: string; model: string }> }) =>
      api.putChain(name, { entries }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
      setShowCreateForm(false);
      setNewChainName('');
      setNewChainProvider('');
      setNewChainModel('');
      setCreateError(null);
    },
    onError: (error: Error) => {
      setCreateError(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteChain(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
      setDeleteConfirmName(null);
      setDeleteError(null);
    },
    onError: (error: Error) => {
      setDeleteError(error.message);
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChainName.trim() || !newChainProvider || !newChainModel.trim()) {
      setCreateError('All fields are required');
      return;
    }
    setCreateError(null);
    createMutation.mutate({
      name: newChainName.trim(),
      entries: [{ provider: newChainProvider, model: newChainModel.trim() }],
    });
  };

  const handleCreateCancel = () => {
    setShowCreateForm(false);
    setNewChainName('');
    setNewChainProvider('');
    setNewChainModel('');
    setCreateError(null);
  };

  const handleDeleteClick = (name: string) => {
    if (deleteConfirmName === name) {
      // Second click - execute delete
      setDeleteError(null);
      deleteMutation.mutate(name);
    } else {
      // First click - show confirmation
      setDeleteConfirmName(name);
      setDeleteError(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmName(null);
    setDeleteError(null);
  };

  const handleEditChain = (name: string) => {
    setSelectedChain(name);
  };

  const handleCloseEditor = () => {
    setSelectedChain(null);
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading chains...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Error loading chains: {error.message}</div>
      </div>
    );
  }

  const config = data as Config;
  const chains: Chain[] = config?.chains || [];
  const providers: Provider[] = config?.providers || [];
  const defaultChain = config?.settings?.defaultChain || 'default';

  // If a chain is selected, show the editor
  // TODO: implement ChainEditor in plan 05-05
  // if (selectedChain) {
  //   const chain = chains.find((c) => c.name === selectedChain);
  //   if (chain) {
  //     return (
  //       <ChainEditor
  //         chainName={chain.name}
  //         entries={chain.entries}
  //         providers={providers}
  //         onClose={handleCloseEditor}
  //       />
  //     );
  //   }
  // }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Chains</h1>
        <button
          className={styles.addButton}
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? 'Cancel' : 'Create Chain'}
        </button>
      </div>

      {showCreateForm && (
        <div className={styles.formSection}>
          <form onSubmit={handleCreateSubmit} className={styles.createForm}>
            <div className={styles.formRow}>
              <label className={styles.label}>
                Chain Name
                <input
                  type="text"
                  value={newChainName}
                  onChange={(e) => setNewChainName(e.target.value)}
                  placeholder="e.g., fast, balanced, quality"
                  className={styles.input}
                  autoFocus
                />
              </label>
            </div>
            <div className={styles.formRow}>
              <label className={styles.label}>
                Initial Provider
                <select
                  value={newChainProvider}
                  onChange={(e) => setNewChainProvider(e.target.value)}
                  className={styles.select}
                >
                  <option value="">Select provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.formRow}>
              <label className={styles.label}>
                Initial Model
                <input
                  type="text"
                  value={newChainModel}
                  onChange={(e) => setNewChainModel(e.target.value)}
                  placeholder="e.g., llama-3.1-8b-instant"
                  className={styles.input}
                />
              </label>
            </div>
            {createError && <div className={styles.formError}>{createError}</div>}
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={handleCreateCancel}
                className={styles.cancelButton}
                disabled={createMutation.isPending}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {chains.length === 0 ? (
        <div className={styles.empty}>No chains configured</div>
      ) : (
        <div className={styles.chainList}>
          {chains.map((chain) => {
            const isDefault = chain.name === defaultChain;
            const canDelete = !isDefault;

            return (
              <div
                key={chain.name}
                className={`${styles.chainCard} ${isDefault ? styles.chainCardDefault : ''}`}
              >
                <div className={styles.chainHeader}>
                  <div className={styles.chainInfo}>
                    <h2 className={styles.chainName}>{chain.name}</h2>
                    {isDefault && <span className={styles.defaultBadge}>Default</span>}
                  </div>
                  <div className={styles.chainMeta}>
                    <span className={styles.entryCount}>
                      {chain.entries.length} {chain.entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                </div>
                <div className={styles.chainEntries}>
                  {chain.entries.map((entry, idx) => (
                    <div key={idx} className={styles.entryPreview}>
                      <span className={styles.entryIndex}>{idx + 1}.</span>
                      <span className={styles.entryProvider}>{entry.provider}</span>
                      <span className={styles.entrySeparator}>/</span>
                      <span className={styles.entryModel}>{entry.model}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.chainActions}>
                  <button
                    className={styles.editButton}
                    onClick={() => handleEditChain(chain.name)}
                  >
                    Edit
                  </button>
                  {canDelete && (
                    <>
                      {deleteConfirmName === chain.name ? (
                        <>
                          <button
                            className={styles.deleteButtonConfirm}
                            onClick={() => handleDeleteClick(chain.name)}
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
                          onClick={() => handleDeleteClick(chain.name)}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                  {deleteError && deleteConfirmName === chain.name && (
                    <div className={styles.deleteError}>{deleteError}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
