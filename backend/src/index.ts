import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import logger from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import budgetRoutes from './routes/budget.js';
import settingsRoutes from './routes/settings.js';
import transactionsRoutes from './routes/transactions.js';
import paymentMethodsRoutes from './routes/paymentMethods.js';
import importRoutes from './routes/import.js';
import accountsRoutes from './routes/accounts.js';
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

// Routes
app.use('/api/budget', budgetRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/payment-methods', paymentMethodsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/transfers', transfersRoutes);

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
