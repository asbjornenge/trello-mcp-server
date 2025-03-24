FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build 
CMD ["node", "build/index.js"]
