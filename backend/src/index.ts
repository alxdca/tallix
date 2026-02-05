import cors from 'cors';
import { sql, eq } from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcrypt';
import { rawDb as db } from './db/index.js';
import { withUserContext } from './db/context.js';
import { users, budgets } from './db/schema.js';
import logger from './logger.js';
import { requireAuth } from './middleware/auth.js';
import { requireBudget } from './middleware/budget.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import accountsRoutes from './routes/accounts.js';
import authRoutes from './routes/auth.js';
import budgetRoutes from './routes/budget.js';
import importRoutes from './routes/import.js';
import paymentMethodsRoutes from './routes/paymentMethods.js';
import settingsRoutes from './routes/settings.js';
import transactionsRoutes from './routes/transactions.js';
import transfersRoutes from './routes/transfers.js';

/**
 * Seed demo user when MODE=demo
 * Creates a demo user with known credentials for testing/demo purposes
 * Only runs when MODE environment variable is set to 'demo'
 */
async function seedDemoUser() {
  if (process.env.MODE !== 'demo') {
    return;
  }

  try {
    const DEMO_EMAIL = 'demo@tallix.org';
    const DEMO_PASSWORD = 'demo';

    // Check if demo user already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, DEMO_EMAIL),
    });

    if (existingUser) {
      logger.info('Demo user already exists');
      return;
    }

    // Create demo user with hashed password
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const [demoUser] = await db
      .insert(users)
      .values({
        email: DEMO_EMAIL,
        passwordHash,
        name: 'Demo User',
        language: 'en',
      })
      .returning();

    // Create default budget for demo user (with user context for RLS)
    await withUserContext(demoUser.id, async (tx) => {
      await tx.insert(budgets).values({
        userId: demoUser.id,
        description: 'Demo Budget',
      });
    });

    logger.info({ email: DEMO_EMAIL }, '✨ Demo user created successfully');
    logger.info('Demo credentials: demo@tallix.org / demo');
  } catch (err) {
    logger.error({ err }, 'Failed to seed demo user');
    // Don't fail startup, just log the error
  }
}

/**
 * Check that the DB role cannot bypass RLS.
 * In production, fails fast if the role has BYPASSRLS or is a superuser.
 * Can be overridden for local development with ALLOW_UNSAFE_DB_ROLE=true.
 */
async function checkDbRole() {
  try {
    const result = await db.execute(sql`
      SELECT current_user AS role,
             rolbypassrls,
             rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const row = result[0] as { role: string; rolbypassrls: boolean; rolsuper: boolean } | undefined;
    
    if (!row) {
      logger.warn('Could not determine database role information');
      return;
    }

    const isUnsafeRole = row.rolbypassrls || row.rolsuper;
    const allowUnsafeRole = process.env.ALLOW_UNSAFE_DB_ROLE === 'true';
    
    if (isUnsafeRole) {
      const logContext = {
        role: row.role,
        bypassRls: row.rolbypassrls,
        superuser: row.rolsuper,
      };

      if (allowUnsafeRole) {
        logger.warn(
          logContext,
          'WARNING: Database role can bypass RLS. This is allowed due to ALLOW_UNSAFE_DB_ROLE=true. DO NOT use in production!'
        );
      } else {
        logger.error(
          logContext,
          'FATAL: Database role can bypass RLS. Application cannot start with a privileged role. ' +
          'Use a non-superuser role without BYPASSRLS, or set ALLOW_UNSAFE_DB_ROLE=true for local development only.'
        );
        process.exit(1);
      }
    } else {
      logger.info({ role: row.role }, 'Database role is RLS-safe');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to verify database role RLS safety');
    // Fail fast on verification errors in production
    if (process.env.ALLOW_UNSAFE_DB_ROLE !== 'true') {
      logger.error('Cannot verify database role safety. Exiting for security.');
      process.exit(1);
    }
  }
}

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
app.use('/api/budget', requireAuth, requireBudget, budgetRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/transactions', requireAuth, requireBudget, transactionsRoutes);
app.use('/api/payment-methods', requireAuth, paymentMethodsRoutes);
app.use('/api/import', requireAuth, requireBudget, importRoutes);
app.use('/api/accounts', requireAuth, requireBudget, accountsRoutes);
app.use('/api/transfers', requireAuth, requireBudget, transfersRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server after verifying database role safety
async function startServer() {
  await checkDbRole();
  await seedDemoUser();
  
  app.listen(PORT, () => {
    logger.info({ port: PORT }, '🚀 Backend server running');
    logger.info({ url: `http://localhost:${PORT}/api/budget` }, '📊 Budget API available');
  });
}

startServer().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
