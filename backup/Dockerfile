FROM node:20-alpine

# postgresql-client provides pg_dump used for the DB backup job
RUN apk add --no-cache postgresql-client tzdata

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /tmp/penoks-backup

CMD ["node", "index.js"]
