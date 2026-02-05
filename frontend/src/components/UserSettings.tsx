import React, { useState } from 'react';
import { changePassword, updateUserSettings } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { logger } from '../utils/logger';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

const COUNTRIES = [
  { code: '', label: '—' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'FR', label: 'France' },
  { code: 'DE', label: 'Germany' },
  { code: 'IT', label: 'Italy' },
  { code: 'AT', label: 'Austria' },
  { code: 'BE', label: 'Belgium' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'ES', label: 'Spain' },
  { code: 'PT', label: 'Portugal' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
];

export default function UserSettings() {
  const { user, updateUser } = useAuth();
  const [language, setLanguage] = useState(user?.language || 'fr');
  const [country, setCountry] = useState(user?.country || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setSuccess('Paramètres mis à jour');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      logger.error('Failed to update settings', err);
      setError('Erreur lors de la mise à jour des paramètres');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (newPassword.length < 6) {
      setError('Le nouveau mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess('Mot de passe modifié avec succès');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      logger.error('Failed to change password', err);
      if (err instanceof Error) {
        // Translate common errors
        if (err.message.includes('Invalid current password')) {
          setError('Mot de passe actuel incorrect');
        } else {
          setError(err.message);
        }
      } else {
        setError('Erreur lors du changement de mot de passe');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="user-settings-container">
      <div className="user-settings-header">
        <h2>Mon compte</h2>
        <p className="user-settings-subtitle">Gérez vos informations personnelles</p>
      </div>

      <div className="user-settings-content">
        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            Informations
          </h3>
          <div className="user-info-card">
            <div className="user-info-row">
              <span className="user-info-label">Email</span>
              <span className="user-info-value">{user?.email}</span>
            </div>
            {user?.name && (
              <div className="user-info-row">
                <span className="user-info-label">Nom</span>
                <span className="user-info-value">{user.name}</span>
              </div>
            )}
            <div className="user-info-row">
              <span className="user-info-label">Langue</span>
              <select
                className="language-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isSavingSettings}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="user-info-row">
              <span className="user-info-label">Pays</span>
              <select
                className="language-select"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={isSavingSettings}
              >
                {COUNTRIES.map((c) => (
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
            {isSavingSettings ? 'Enregistrement...' : 'Enregistrer les modifications'}
          </button>
        </div>

        <div className="user-settings-section">
          <h3 className="section-title">
            <span className="section-indicator"></span>
            Changer le mot de passe
          </h3>
          <form onSubmit={handleChangePassword} className="password-form">
            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success">{success}</div>}
            <div className="form-group">
              <label htmlFor="currentPassword">Mot de passe actuel</label>
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
              <label htmlFor="newPassword">Nouveau mot de passe</label>
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
              <label htmlFor="confirmPassword">Confirmer le nouveau mot de passe</label>
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
              {isSubmitting ? 'Modification...' : 'Modifier le mot de passe'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
