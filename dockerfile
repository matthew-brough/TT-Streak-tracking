FROM node:24-alpine

WORKDIR /app

# Install Deps
COPY package*.json ./
RUN npm ci --omit=dev

COPY Tracker/index.js ./server.js
COPY Tracker/userapp ./userapp

# EXPOSE ${APP_PORT}

CMD ["node", "server.js"]