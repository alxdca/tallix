interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  currentYear: number;
}

export default function Sidebar({ activeView, onViewChange, currentYear }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">Tallix</span>
        </div>
      </div>
      
      <nav className="sidebar-nav">
        {/* Current Year with sub-items */}
        <div className="nav-group">
          <button
            className={`nav-item ${activeView === 'current' ? 'active' : ''}`}
            onClick={() => onViewChange('current')}
          >
            <span className="nav-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <span className="nav-label">{currentYear}</span>
          </button>
          
          {/* Sub-item: Transactions */}
          <button
            className={`nav-item nav-sub-item ${activeView === 'transactions' ? 'active' : ''}`}
            onClick={() => onViewChange('transactions')}
          >
            <span className="nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </span>
            <span className="nav-label">Transactions</span>
          </button>

          {/* Sub-item: Accounts */}
          <button
            className={`nav-item nav-sub-item ${activeView === 'accounts' ? 'active' : ''}`}
            onClick={() => onViewChange('accounts')}
          >
            <span className="nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </span>
            <span className="nav-label">Comptes</span>
          </button>

          {/* Sub-item: Budget Planning */}
          <button
            className={`nav-item nav-sub-item ${activeView === 'budget-planning' ? 'active' : ''}`}
            onClick={() => onViewChange('budget-planning')}
          >
            <span className="nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="2" />
                <path d="M9 12h6" />
                <path d="M9 16h6" />
              </svg>
            </span>
            <span className="nav-label">Planification</span>
          </button>
        </div>

        {/* Archive */}
        <button
          className={`nav-item ${activeView === 'archive' ? 'active' : ''}`}
          onClick={() => onViewChange('archive')}
        >
          <span className="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </span>
          <span className="nav-label">Archive</span>
        </button>

        {/* Settings */}
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
          <span className="nav-label">Paramètres</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="version">v1.0.0</div>
      </div>
    </aside>
  );
}
