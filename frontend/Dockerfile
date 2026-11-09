FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Unprivileged nginx runs as uid 101 and listens on 8080, so the pod can run as non-root.
FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG APP_VERSION=dev
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER root
RUN echo "$APP_VERSION" > /usr/share/nginx/html/version.txt
USER 101
EXPOSE 8080
