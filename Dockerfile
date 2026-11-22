# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643 AS builder

ARG TARGETPLATFORM
WORKDIR /app

COPY index.ts tsconfig.json ./
COPY src ./src

# Zero third-party runtime dependencies: compile directly to a standalone binary.
RUN case "$TARGETPLATFORM" in \
    "linux/amd64") TARGET="bun-linux-x64-baseline" ;; \
    "linux/arm64") TARGET="bun-linux-arm64" ;; \
    *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac && \
    bun build --compile --minify ./index.ts --target "$TARGET" --outfile /app/server

# Minimal non-root Chainguard glibc-dynamic runtime pinned by digest.
FROM cgr.dev/chainguard/glibc-dynamic:latest@sha256:3359c6ba6b3bcf3b1d2179849f782365564cb262789e732e2833b25b9a8c00f1

COPY --from=builder /app/server /server

USER 65532:65532
EXPOSE 3000
ENTRYPOINT ["/server"]
