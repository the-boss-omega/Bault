# MinIO for local development (infra/docker-compose.yml), built from source.
#
# The compose file used `quay.io/minio/minio:latest`, and MinIO no longer
# publishes community images: `minio/minio` is gone from Docker Hub, and the
# quay.io pull failed on every CI run. A failed pull stops
# `docker compose up` before anything starts, Postgres included. The source is
# still published, and the Go module proxy serves every version it has ever
# served, checked against the checksum database on download.
#
# The same server release as CI (MINIO_VERSION in .github/workflows/ci.yml),
# plus `mc`, which the setup steps use to make the bucket. The first
# `docker compose up` builds it, which takes a few minutes; after that the
# image is reused.

FROM golang:1.24-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac AS build

# github.com/minio/minio at RELEASE.2025-09-07T16-13-09Z
ARG MINIO_VERSION=v0.0.0-20250907161309-07c3a429bfed
# github.com/minio/mc at RELEASE.2025-08-13T08-35-41Z
ARG MC_VERSION=v0.0.0-20250813083541-7394ce0dd2a8

# Static binaries, as MinIO's own releases were.
ENV CGO_ENABLED=0 GOBIN=/out
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go install "github.com/minio/minio@${MINIO_VERSION}" \
 && go install "github.com/minio/mc@${MC_VERSION}"

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
COPY --from=build /out/minio /out/mc /usr/local/bin/
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
