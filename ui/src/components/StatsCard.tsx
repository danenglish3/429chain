import styles from './StatsCard.module.css';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
}

export default function StatsCard({ title, value, subtitle }: StatsCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      <div className={styles.value}>{value}</div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
    </div>
  );
}
