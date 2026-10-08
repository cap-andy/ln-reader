FROM node:20-alpine
WORKDIR /app
COPY node_modules ./node_modules
COPY package*.json ./
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
