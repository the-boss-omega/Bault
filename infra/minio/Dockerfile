
FROM golang:1.25-bookworm@sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437 AS build

ARG MINIO_VERSION=v0.0.0-20250907161309-07c3a429bfed
ARG MC_VERSION=v0.0.0-20250813083541-7394ce0dd2a8

ENV CGO_ENABLED=0 GOBIN=/out
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go install "github.com/minio/minio@${MINIO_VERSION}" \
 && go install "github.com/minio/mc@${MC_VERSION}"

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
COPY --from=build /out/minio /out/mc /usr/local/bin/
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
