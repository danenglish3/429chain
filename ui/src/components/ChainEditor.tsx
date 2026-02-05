import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { api } from '../lib/api.js';
import { queryKeys } from '../lib/queryKeys.js';
import SortableEntry from './SortableEntry.js';
import styles from './ChainEditor.module.css';

interface Entry {
  provider: string;
  model: string;
}

interface SortableEntry {
  id: string;
  provider: string;
  model: string;
}

interface Provider {
  id: string;
  name: string;
  type: string;
}

interface ChainEditorProps {
  chainName: string;
  entries: Entry[];
  providers: Provider[];
  onClose: () => void;
}

export default function ChainEditor({ chainName, entries, providers, onClose }: ChainEditorProps) {
  // Convert entries to sortable format with unique IDs
  const [items, setItems] = useState<SortableEntry[]>(() =>
    entries.map((e, i) => ({ ...e, id: String(i) }))
  );
  const [addProvider, setAddProvider] = useState('');
  const [addModel, setAddModel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // Update local state when entries prop changes
  useEffect(() => {
    setItems(entries.map((e, i) => ({ ...e, id: String(i) })));
  }, [entries]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const saveMutation = useMutation({
    mutationFn: (updatedEntries: Entry[]) =>
      api.putChain(chainName, { entries: updatedEntries }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
      setSaveError(null);
    },
    onError: (error: Error) => {
      setSaveError(error.message);
      // Revert to last known good state
      setItems(entries.map((e, i) => ({ ...e, id: String(i) })));
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);
      setItems(newItems);

      // Save immediately after reorder
      saveMutation.mutate(newItems.map(({ provider, model }) => ({ provider, model })));
    }
  };

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addProvider || !addModel.trim()) {
      setAddError('Provider and model are required');
      return;
    }
    setAddError(null);

    const newEntry = { provider: addProvider, model: addModel.trim() };
    const newItems = [...items, { ...newEntry, id: String(items.length) }];
    setItems(newItems);

    // Save after adding
    saveMutation.mutate(newItems.map(({ provider, model }) => ({ provider, model })));

    // Clear form
    setAddProvider('');
    setAddModel('');
  };

  const handleRemoveEntry = (id: string) => {
    // Prevent removing last entry (min 1 constraint)
    if (items.length <= 1) {
      setSaveError('Cannot remove last entry - chains must have at least one entry');
      return;
    }

    const newItems = items.filter((item) => item.id !== id);
    // Reassign IDs to maintain consistency
    const reindexedItems = newItems.map((item, i) => ({ ...item, id: String(i) }));
    setItems(reindexedItems);

    // Save after removing
    saveMutation.mutate(reindexedItems.map(({ provider, model }) => ({ provider, model })));
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Edit Chain: {chainName}</h1>
          <p className={styles.subtitle}>
            Drag entries to reorder. First entry is tried first, then fallback in order.
          </p>
        </div>
        <button onClick={onClose} className={styles.closeButton}>
          Close
        </button>
      </div>

      {saveError && <div className={styles.error}>{saveError}</div>}
      {saveMutation.isPending && (
        <div className={styles.saving}>Saving changes...</div>
      )}

      <div className={styles.content}>
        <div className={styles.entriesSection}>
          <h2 className={styles.sectionTitle}>Chain Entries</h2>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              <div className={styles.entryList}>
                {items.map((item) => (
                  <SortableEntry
                    key={item.id}
                    id={item.id}
                    provider={item.provider}
                    model={item.model}
                    onRemove={handleRemoveEntry}
                    canRemove={items.length > 1}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className={styles.addSection}>
          <h2 className={styles.sectionTitle}>Add Entry</h2>
          <form onSubmit={handleAddEntry} className={styles.addForm}>
            <div className={styles.addFormFields}>
              <div className={styles.formField}>
                <label className={styles.label}>
                  Provider
                  <select
                    value={addProvider}
                    onChange={(e) => setAddProvider(e.target.value)}
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
              <div className={styles.formField}>
                <label className={styles.label}>
                  Model
                  <input
                    type="text"
                    value={addModel}
                    onChange={(e) => setAddModel(e.target.value)}
                    placeholder="e.g., llama-3.1-8b-instant"
                    className={styles.input}
                  />
                </label>
              </div>
            </div>
            {addError && <div className={styles.addError}>{addError}</div>}
            <button
              type="submit"
              className={styles.addButton}
              disabled={saveMutation.isPending}
            >
              Add Entry
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
