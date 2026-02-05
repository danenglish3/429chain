import { useState, useEffect } from 'react';
import { NavLink } from 'react-router';
import { getApiKey, setApiKey } from '../lib/api.js';
import styles from './Layout.module.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    setHasApiKey(!!getApiKey());
  }, []);

  const handleSetApiKey = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim());
      setHasApiKey(true);
      setApiKeyInput('');
    }
  };

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.header}>
          <h1 className={styles.title}>429chain</h1>
        </div>

        <div className={styles.apiKeySection}>
          <div className={styles.apiKeyStatus}>
            API Key: {hasApiKey ? <span className={styles.statusSet}>(set)</span> : <span className={styles.statusNotSet}>(not set)</span>}
          </div>
          <div className={styles.apiKeyForm}>
            <input
              type="password"
              placeholder="Enter API key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetApiKey()}
              className={styles.apiKeyInput}
            />
            <button onClick={handleSetApiKey} className={styles.apiKeyButton}>
              Set
            </button>
          </div>
        </div>

        <nav className={styles.nav}>
          <NavLink to="/" end className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
            Dashboard
          </NavLink>
          <NavLink to="/providers" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
            Providers
          </NavLink>
          <NavLink to="/chains" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
            Chains
          </NavLink>
          <NavLink to="/test" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}>
            Test
          </NavLink>
        </nav>
      </aside>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
