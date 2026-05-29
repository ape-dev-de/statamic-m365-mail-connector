FROM node:22-alpine

WORKDIR /app
# package.json pins type:commonjs (the repo root is type:module); server.test.js
# is intentionally NOT copied into the image.
COPY package.json server.js ./

ENV PORT=8080
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "server.js"]
