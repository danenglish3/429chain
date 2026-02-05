import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import styles from './ProviderForm.module.css';

const providerFormSchema = z.object({
  id: z.string().min(1, 'Provider ID is required'),
  name: z.string().min(1, 'Provider name is required'),
  type: z.enum(['openrouter', 'groq', 'cerebras', 'generic-openai'], 'Please select a provider type'),
  apiKey: z.string().min(1, 'API key is required'),
  baseUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

type ProviderFormData = z.infer<typeof providerFormSchema>;

interface ProviderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ProviderForm({ onSuccess, onCancel }: ProviderFormProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProviderFormData>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      id: '',
      name: '',
      type: 'openrouter',
      apiKey: '',
      baseUrl: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ProviderFormData) => {
      const payload = {
        ...data,
        baseUrl: data.baseUrl || undefined, // Convert empty string to undefined
      };
      return api.putProvider(data.id, payload);
    },
    onSuccess: () => {
      setServerError(null);
      onSuccess();
    },
    onError: (error: Error) => {
      setServerError(error.message);
    },
  });

  const onSubmit = (data: ProviderFormData) => {
    setServerError(null);
    mutation.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>
      {serverError && (
        <div className={styles.serverError}>
          {serverError}
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="id" className={styles.label}>
          Provider ID *
        </label>
        <input
          id="id"
          type="text"
          {...register('id')}
          className={styles.input}
          placeholder="e.g., provider-1"
        />
        {errors.id && (
          <div className={styles.error}>{errors.id.message}</div>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="name" className={styles.label}>
          Provider Name *
        </label>
        <input
          id="name"
          type="text"
          {...register('name')}
          className={styles.input}
          placeholder="e.g., My OpenRouter Provider"
        />
        {errors.name && (
          <div className={styles.error}>{errors.name.message}</div>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="type" className={styles.label}>
          Provider Type *
        </label>
        <select
          id="type"
          {...register('type')}
          className={styles.select}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="groq">Groq</option>
          <option value="cerebras">Cerebras</option>
          <option value="generic-openai">Generic OpenAI</option>
        </select>
        {errors.type && (
          <div className={styles.error}>{errors.type.message}</div>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="apiKey" className={styles.label}>
          API Key *
        </label>
        <div className={styles.passwordField}>
          <input
            id="apiKey"
            type={showApiKey ? 'text' : 'password'}
            {...register('apiKey')}
            className={styles.input}
            placeholder="sk-..."
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className={styles.toggleButton}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {errors.apiKey && (
          <div className={styles.error}>{errors.apiKey.message}</div>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="baseUrl" className={styles.label}>
          Base URL
          <span className={styles.optional}>(optional)</span>
        </label>
        <input
          id="baseUrl"
          type="text"
          {...register('baseUrl')}
          className={styles.input}
          placeholder="https://api.example.com"
        />
        {errors.baseUrl && (
          <div className={styles.error}>{errors.baseUrl.message}</div>
        )}
      </div>

      <div className={styles.buttonRow}>
        <button
          type="submit"
          disabled={mutation.isPending}
          className={styles.submitButton}
        >
          {mutation.isPending ? 'Adding Provider...' : 'Add Provider'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={mutation.isPending}
          className={styles.cancelButton}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
