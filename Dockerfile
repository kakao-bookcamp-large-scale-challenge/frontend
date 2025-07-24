# FROM node:20-alpine AS builder
# WORKDIR /app
# COPY package.json package-lock.json ./
# RUN npm install
# COPY . .
# WORKDIR /app/frontend
# RUN npm run build

# FROM node:20-alpine
# WORKDIR /app
# COPY --from=builder /app/frontend/.next ./.next
# COPY --from=builder /app/frontend/node_modules ./node_modules
# COPY --from=builder /app/frontend/public ./public
# COPY --from=builder /app/frontend/package.json ./package.json
# EXPOSE 3000
# CMD ["npm", "run", "start"]


# 1단계: 빌드
FROM node:20-alpine AS builder

# 루트 경로
WORKDIR /app

# 루트 package.json 복사 및 설치
COPY package*.json ./
RUN npm install

# 전체 소스 복사
COPY . .

# 👉 Next.js 설치 및 빌드
WORKDIR /app/frontend
RUN npm install

# 👉 환경변수 선언 (Build Args)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ENCRYPTION_KEY
ARG NEXT_PUBLIC_PASSWORD_SALT
ARG NEXT_PUBLIC_AWS_ACCESS_KEY_ID
ARG NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY
ARG NEXT_PUBLIC_AWS_REGION
ARG NEXT_PUBLIC_S3_BUCKET_NAME

# 👉 Next.js는 빌드시 NEXT_PUBLIC_* 환경변수만 클라이언트에 노출됨
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_ENCRYPTION_KEY=${NEXT_PUBLIC_ENCRYPTION_KEY}
ENV NEXT_PUBLIC_PASSWORD_SALT=${NEXT_PUBLIC_PASSWORD_SALT}
ENV NEXT_PUBLIC_AWS_ACCESS_KEY_ID=${NEXT_PUBLIC_AWS_ACCESS_KEY_ID}
ENV NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY=${NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY}
ENV NEXT_PUBLIC_AWS_REGION=${NEXT_PUBLIC_AWS_REGION}
ENV NEXT_PUBLIC_S3_BUCKET_NAME=${NEXT_PUBLIC_S3_BUCKET_NAME}

RUN npm run build   # 이제 next build 가능

# 2단계: 실행 이미지 (경량화)
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# 런타임에 필요한 파일만 복사
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/frontend/package.json ./
COPY --from=builder /app/frontend/node_modules ./node_modules

EXPOSE 3000

# 실행
CMD ["npm", "run", "start"]
