import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import logger from './logger.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import accountsRoutes from './routes/accounts.js';
import authRoutes from './routes/auth.js';
import budgetRoutes from './routes/budget.js';
import importRoutes from './routes/import.js';
import paymentMethodsRoutes from './routes/paymentMethods.js';
import settingsRoutes from './routes/settings.js';
import transactionsRoutes from './routes/transactions.js';
import transfersRoutes from './routes/transfers.js';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Public routes (no auth required)
app.use('/api/auth', authRoutes);

// Protected routes (auth required)
app.use('/api/budget', requireAuth, budgetRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/transactions', requireAuth, transactionsRoutes);
app.use('/api/payment-methods', requireAuth, paymentMethodsRoutes);
app.use('/api/import', requireAuth, importRoutes);
app.use('/api/accounts', requireAuth, accountsRoutes);
app.use('/api/transfers', requireAuth, transfersRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT }, '🚀 Backend server running');
  logger.info({ url: `http://localhost:${PORT}/api/budget` }, '📊 Budget API available');
});
