# Build stage
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

# Build the app
WORKDIR /app/backend
RUN pnpm build

# Production stage
FROM node:22-alpine

# Install pnpm for running migrations
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files for pnpm
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/backend/dist ./backend/dist

# Copy drizzle migrations and config
COPY backend/drizzle ./backend/drizzle
COPY backend/drizzle.config.ts ./backend/

WORKDIR /app/backend

EXPOSE 3001

# Run migrations and start the server
CMD ["sh", "-c", "node dist/index.js"]
