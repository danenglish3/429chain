import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './ChainEditor.module.css';

interface SortableEntryProps {
  id: string;
  provider: string;
  model: string;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

export default function SortableEntry({ id, provider, model, onRemove, canRemove }: SortableEntryProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.entry}>
      <div className={styles.dragHandle} {...attributes} {...listeners}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ cursor: 'grab' }}
        >
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="4" cy="8" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <circle cx="4" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      </div>
      <div className={styles.entryContent}>
        <div className={styles.entryProvider}>{provider}</div>
        <div className={styles.entrySeparator}>/</div>
        <div className={styles.entryModel}>{model}</div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(id)}
        disabled={!canRemove}
        className={styles.removeButton}
        title={canRemove ? 'Remove entry' : 'Cannot remove last entry'}
      >
        Remove
      </button>
    </div>
  );
}
