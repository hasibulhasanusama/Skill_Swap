FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
COPY --chown=node:node public ./public
RUN mkdir -p storage/private && chown -R node:node storage
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js && exec node server/index.js"]