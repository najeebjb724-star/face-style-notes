FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

LABEL org.opencontainers.image.base.digest="sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["npm", "start"]
