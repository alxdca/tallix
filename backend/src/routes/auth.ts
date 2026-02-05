import { Router, type Router as RouterType } from 'express';
import { login, register, verifyToken, getUserById, changePassword } from '../services/auth';
import logger from '../logger.js';

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
    logger.warn({ error }, 'Login failed');
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
