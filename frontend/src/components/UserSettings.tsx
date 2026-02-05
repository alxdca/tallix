import React, { useMemo, useState } from 'react';
import { changePassword, updateUserSettings } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { getErrorMessage } from '../utils/errorMessages';
import { logger } from '../utils/logger';

const COUNTRY_LIST = [
  '',
  'CH',
  'FR',
  'DE',
  'IT',
  'AT',
  'BE',
  'NL',
  'LU',
  'ES',
  'PT',
  'GB',
  'US',
  'CA',
];

export default function UserSettings() {
  const { user, updateUser } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const [language, setLanguage] = useState(user?.language || 'fr');
  const [country, setCountry] = useState(user?.country || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const languageOptions = useMemo(
    () => [
      { code: 'en', label: t('language.en') },
      { code: 'fr', label: t('language.fr') },
    ],
    [t]
  );

  const countryLabels = useMemo(() => {
    try {
      const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
      return COUNTRY_LIST.map((code) => ({
        code,
        label: code ? displayNames.of(code) || code : t('countries.none'),
      }));
    } catch {
      return COUNTRY_LIST.map((code) => ({ code, label: code || t('countries.none') }));
    }
  }, [locale, t]);

  // Update local state when user changes
  React.useEffect(() => {
    if (user) {
      setLanguage(user.language || 'fr');
      setCountry(user.country || '');
    }
  }, [user]);

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setError(null);
    try {
      const updatedUser = await updateUserSettings({
        language,
        country,
      });
      updateUser({
        language: updatedUser.language,
        country: updatedUser.country,
      });
      if (updatedUser.language === 'en' || updatedUser.language === 'fr') {
        setLocale(updatedUser.language);
      }
      setSuccess(t('userSettings.settingsUpdated'));
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      logger.error('Failed to update settings', err);
      setError(getErrorMessage(err, t));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError(t('userSettings.passwordMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('userSettings.passwordMinLength'));
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(t('userSettings.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      logger.error('Failed to change password', err);
      setError(getErrorMessage(err, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="user-settings-container">
        <div className="user-settings-header">
        <h2>{t('userSettings.title')}</h2>
        <p className="user-settings-subtitle">{t('userSettings.subtitle')}</p>
      </div>

      <div className="user-settings-content">
        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            {t('userSettings.info')}
          </h3>
          <div className="user-info-card">
            <div className="user-info-row">
              <span className="user-info-label">{t('userSettings.email')}</span>
              <span className="user-info-value">{user?.email}</span>
            </div>
            {user?.name && (
              <div className="user-info-row">
                <span className="user-info-label">{t('userSettings.name')}</span>
                <span className="user-info-value">{user.name}</span>
              </div>
            )}
            <div className="user-info-row">
              <span className="user-info-label">{t('userSettings.language')}</span>
              <select
                className="language-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isSavingSettings}
              >
                {languageOptions.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="user-info-row">
              <span className="user-info-label">{t('userSettings.country')}</span>
              <select
                className="language-select"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={isSavingSettings}
              >
                {countryLabels.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ display: 'flex', margin: '20px auto 0', padding: '12px 32px' }}
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
          >
            {isSavingSettings ? t('userSettings.saving') : t('userSettings.saveChanges')}
          </button>
        </div>

        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            {t('userSettings.passwordTitle')}
          </h3>
          <form onSubmit={handleChangePassword} className="password-form">
            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success">{success}</div>}
            <div className="form-group">
              <label htmlFor="currentPassword">{t('userSettings.currentPassword')}</label>
              <input
                type="password"
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPassword">{t('userSettings.newPassword')}</label>
              <input
                type="password"
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isSubmitting}
                minLength={6}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">{t('userSettings.confirmNewPassword')}</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isSubmitting}
                minLength={6}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t('userSettings.changing') : t('userSettings.changePassword')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
