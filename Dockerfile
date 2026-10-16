FROM node:22.19.0-bookworm-slim

WORKDIR /app

COPY . .

RUN npm ci
RUN npm test
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SIMULATION_WORKERS=500

EXPOSE 3000

CMD ["npm", "start"]
