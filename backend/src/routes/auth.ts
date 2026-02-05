import { Router, type Router as RouterType } from 'express';
import { login, register, verifyToken, getUserById, changePassword, updateUser, getSetupStatus } from '../services/auth';
import logger from '../logger.js';
import { VALID_LANGUAGE_CODES } from '../constants/languages.js';

const router: RouterType = Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await login(email, password);
    logger.info({ email }, 'User logged in');
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    logger.warn({ error }, 'Login failed');
    if (message === 'Initial setup required') {
      res.status(403).json({ error: message });
      return;
    }
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const result = await register(email, password, name);
    logger.info({ email }, 'User registered');
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    logger.warn({ error }, 'Registration failed');
    res.status(400).json({ error: message });
  }
});

// Verify token / get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const { userId } = verifyToken(token);
    const user = await getUserById(userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Setup status (no auth required)
router.get('/setup', async (_req, res) => {
  try {
    const status = await getSetupStatus();
    res.json(status);
  } catch (error) {
    logger.warn({ error }, 'Setup status failed');
    res.status(500).json({ error: 'Failed to determine setup status' });
  }
});

// Update user settings
router.patch('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const { userId } = verifyToken(token);

    const { name, language, country } = req.body;

    // Validate language if provided
    if (language && !VALID_LANGUAGE_CODES.includes(language)) {
      return res.status(400).json({ error: `Invalid language. Supported: ${VALID_LANGUAGE_CODES.join(', ')}` });
    }

    // Validate country if provided (ISO 3166-1 alpha-2)
    if (country !== undefined && country !== '' && (typeof country !== 'string' || country.length !== 2)) {
      return res.status(400).json({ error: 'Invalid country code. Use ISO 3166-1 alpha-2 format (e.g., FR, CH).' });
    }

    const user = await updateUser(userId, { name, language, country });
    logger.info({ userId, language, country }, 'User settings updated');
    res.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update user';
    logger.warn({ error }, 'User update failed');
    res.status(400).json({ error: message });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const { userId } = verifyToken(token);

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    await changePassword(userId, currentPassword, newPassword);
    logger.info({ userId }, 'Password changed');
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to change password';
    logger.warn({ error }, 'Password change failed');
    res.status(400).json({ error: message });
  }
});

export default router;
