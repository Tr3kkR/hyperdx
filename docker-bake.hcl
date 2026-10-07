group "default" {
  targets = ["hyperdx", "all-in-one", "all-in-one-noauth"]
}

target "hyperdx" {
  context = "."
  dockerfile = "docker/hyperdx/Dockerfile"
  contexts = {
    hyperdx = "./docker/hyperdx"
    api = "./packages/api"
    app = "./packages/app"
    clickhouse = "./docker/clickhouse"
    otel-collector = "./docker/otel-collector"
  }
  target = "prod"
  tags = ["hyperdx:sqlite"]
}

target "all-in-one" {
  context = "."
  dockerfile = "docker/hyperdx/Dockerfile"
  contexts = {
    hyperdx = "./docker/hyperdx"
    api = "./packages/api"
    app = "./packages/app"
    clickhouse = "./docker/clickhouse"
    otel-collector = "./docker/otel-collector"
  }
  target = "all-in-one-auth"
  tags = ["hyperdx-all-in-one:sqlite"]
}

target "all-in-one-noauth" {
  context = "."
  dockerfile = "docker/hyperdx/Dockerfile"
  contexts = {
    hyperdx = "./docker/hyperdx"
    api = "./packages/api"
    app = "./packages/app"
    clickhouse = "./docker/clickhouse"
    otel-collector = "./docker/otel-collector"
  }
  target = "all-in-one-noauth"
  tags = ["hyperdx-all-in-one-noauth:sqlite"]
}
