#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REGISTRY = process.env.IMAGE_REGISTRY || "ps-docker-registry.cn-beijing.cr.aliyuncs.com"
const IMAGE_NAME = process.env.IMAGE_NAME || "psdsframework/pszx-doc-write-agent"
const DEFAULT_PLATFORM = process.env.DOCKER_PLATFORM || "linux/amd64"
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

function fail(message) {
  console.error(`\nError: ${message}\n`)
  process.exit(1)
}

function latestTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    }).trim()
  } catch {
    return ""
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT_DIR, stdio: "inherit" })
  if (result.error) fail(`${command} is unavailable: ${result.error.message}`)
  if (result.status !== 0) fail(`command failed: ${command} ${args.join(" ")}`)
}

const dockerInfo = spawnSync("docker", ["info"], { stdio: "ignore" })
if (dockerInfo.error || dockerInfo.status !== 0) fail("Docker is not running or unavailable")

const version = process.argv[2] || latestTag()
const platform = process.argv[3] || DEFAULT_PLATFORM
if (!version) {
  fail("no version supplied and no git tag exists; run node scripts/release.js first")
}
if (!VERSION_PATTERN.test(version)) fail(`invalid image tag: ${version}`)
if (!platform) fail("missing Docker platform")

const image = `${REGISTRY}/${IMAGE_NAME}:${version}`
const buildArgs = [
  "buildx",
  "build",
  "--platform",
  platform,
  "--tag",
  image,
  "--file",
  "docker/Dockerfile",
]

if (platform.includes(",")) {
  run("docker", [...buildArgs, "--push", "."])
} else {
  run("docker", [...buildArgs, "--load", "."])
  run("docker", ["push", image])
}

console.log(`Image published: ${image}`)
