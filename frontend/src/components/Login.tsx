import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { getErrorMessage } from '../utils/errorMessages';

export default function Login() {
  const { login, register } = useAuth();
  const { t } = useI18n();
  const [isRegister, setIsRegister] = useState(false);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchSetupStatus = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/api/auth/setup`);
        if (!response.ok) {
          setNeedsSetup(false);
          return;
        }
        const data = (await response.json()) as { needsSetup: boolean };
        setNeedsSetup(data.needsSetup);
        if (data.needsSetup) {
          setIsRegister(true);
        }
      } catch {
        setNeedsSetup(false);
      }
    };

    fetchSetupStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isRegister) {
        if (password !== confirmPassword) {
          setError(t('login.passwordMismatch'));
          setIsLoading(false);
          return;
        }
        await register(email, password, name || undefined);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-logo">Tallix</h1>
          <p className="login-subtitle">
            {needsSetup ? t('login.adminSetup') : isRegister ? t('login.createAccount') : t('login.signIn')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {isRegister && (
            <div className="form-group">
              <label htmlFor="name">{t('login.name')}</label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('login.yourName')}
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">{t('login.email')}</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('login.password')}</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegister ? t('login.passwordMin') : t('login.passwordPlaceholder')}
              required
              minLength={isRegister ? 8 : undefined}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="confirmPassword">{t('login.confirmPassword')}</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('login.confirmPasswordPlaceholder')}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? t('login.loading') : isRegister ? t('login.signUp') : t('login.signInAction')}
          </button>
        </form>

        {needsSetup ? null : (
          <div className="login-footer">
            <button
              type="button"
              className="login-switch"
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
              }}
            >
              {isRegister ? t('login.alreadyHaveAccount') : t('login.noAccount')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
