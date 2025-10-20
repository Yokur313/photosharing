FROM node:20-bookworm-slim
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install system deps needed for native modules (e.g., sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (use install to avoid lockfile mismatch failures in CI)
RUN npm install --omit=dev --no-audit --no-fund

# Copy source code
COPY . .

# Create data directory for shares
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Set PORT environment variable
ENV PORT=3000

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "src/server.js"]
