import { useEffect, useRef, useState } from 'react';
import type { AccessibleBudget } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  budgets: AccessibleBudget[];
  activeBudgetId: number | null;
  onBudgetChange: (budgetId: number) => void;
  selectedYear: number;
  onYearChange: (year: number) => void;
}

export default function Sidebar({
  activeView,
  onViewChange,
  budgets,
  activeBudgetId,
  onBudgetChange,
  selectedYear,
  onYearChange,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeBudget = budgets.find((budget) => budget.id === activeBudgetId);
  const activeBudgetRole = activeBudget?.role;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  const formatBudgetLabel = (budget: AccessibleBudget) => {
    const ownerLabel =
      budget.role === 'owner'
        ? t('sharing.myBudget')
        : t('sharing.sharedBy', { owner: budget.ownerName || budget.ownerEmail });
    return budget.description || ownerLabel;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">Tallix</span>
        </div>
        {budgets.length > 0 && (
          <div className="budget-switcher">
            <label htmlFor="active-budget">{t('sharing.budget')}</label>
            <div className="budget-select-control">
              <svg
                className="budget-select-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 8V5H6a3 3 0 0 0-3 3v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a3 3 0 0 1 0-6h12" />
                <path d="M21 12h-4a2 2 0 0 0 0 4h4" />
              </svg>
              <select
                id="active-budget"
                value={activeBudgetId ?? ''}
                onChange={(event) => {
                  onBudgetChange(Number(event.target.value));
                }}
              >
                {budgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {formatBudgetLabel(budget)}
                  </option>
                ))}
              </select>
              <svg
                className="budget-select-chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m8 10 4 4 4-4" />
              </svg>
            </div>
            <label htmlFor="active-year">{t('sharing.year')}</label>
            <div className="budget-select-control">
              <svg
                className="budget-select-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 11h18" />
              </svg>
              <select
                id="active-year"
                value={selectedYear}
                onChange={(event) => onYearChange(Number(event.target.value))}
              >
                {[...(activeBudget?.years ?? [])]
                  .sort((a, b) => b - a)
                  .map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
              </select>
              <svg
                className="budget-select-chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m8 10 4 4 4-4" />
              </svg>
            </div>
            {activeBudgetRole !== 'owner' && (
              <span className="budget-access-badge">
                {activeBudgetRole === 'write' ? t('sharing.writeAccess') : t('sharing.readAccess')}
              </span>
            )}
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${activeView === 'current' ? 'active' : ''}`}
          onClick={() => onViewChange('current')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="9" x2="9" y2="21" />
            </svg>
          </span>
          <span className="nav-label">{t('nav.budget')}</span>
        </button>

        <button
          className={`nav-item ${activeView === 'transactions' ? 'active' : ''}`}
          onClick={() => onViewChange('transactions')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          <span className="nav-label">{t('nav.transactions')}</span>
        </button>

        <button
          className={`nav-item ${activeView === 'accounts' ? 'active' : ''}`}
          onClick={() => onViewChange('accounts')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </span>
          <span className="nav-label">{t('nav.accounts')}</span>
        </button>

        <button
          className={`nav-item ${activeView === 'budget-planning' ? 'active' : ''}`}
          onClick={() => onViewChange('budget-planning')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="2" />
              <path d="M9 12h6" />
              <path d="M9 16h6" />
            </svg>
          </span>
          <span className="nav-label">{t('nav.planning')}</span>
        </button>

        <button
          className={`nav-item ${activeView === 'playground' ? 'active' : ''}`}
          onClick={() => onViewChange('playground')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 3h6v2H9zM10 5v6l-4 8h12l-4-8V5" />
              <path d="M7 19h10" />
            </svg>
          </span>
          <span className="nav-label">{t('nav.playground')}</span>
        </button>

        {/* Assets (multi-year) */}
        <button
          className={`nav-item ${activeView === 'assets' ? 'active' : ''}`}
          onClick={() => onViewChange('assets')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </span>
          <span className="nav-label">{t('nav.assets')}</span>
        </button>

        {/* Settings */}
        {activeBudgetRole !== 'read' && (
          <button
            className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => onViewChange('settings')}
          >
            <span className="nav-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span className="nav-label">{t('nav.settings')}</span>
          </button>
        )}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <div className="user-menu-container" ref={menuRef}>
            <button className="user-info" onClick={() => setShowUserMenu(!showUserMenu)} type="button">
              <span className="user-avatar">{(user.name || user.email).charAt(0).toUpperCase()}</span>
              <span className="user-name">{user.name || user.email}</span>
              <svg
                className={`user-menu-chevron ${showUserMenu ? 'open' : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showUserMenu && (
              <div className="user-menu">
                <button
                  className="user-menu-item"
                  onClick={() => {
                    setShowUserMenu(false);
                    onViewChange('user-settings');
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {t('nav.myAccount')}
                </button>
                <button
                  className="user-menu-item danger"
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  {t('nav.logout')}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="version">v1.0.0</div>
      </div>
    </aside>
  );
}
