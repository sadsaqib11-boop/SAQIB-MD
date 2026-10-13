# SAQIB-MD Premium WhatsApp Bot
FROM node:20-slim

# ffmpeg is required for stickers / audio effects / media conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
