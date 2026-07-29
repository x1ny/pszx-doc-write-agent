#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import http from "node:http"
import https from "node:https"

const redeployUrl = process.env.RANCHER_REDEPLOY_URL
const token = process.env.RANCHER_DEPLOY_TOKEN
const insecureTls = process.env.DEPLOY_INSECURE_TLS === "1"

function fail(message) {
  console.error(`\nError: ${message}\n`)
  process.exit(1)
}

if (!redeployUrl) fail("missing RANCHER_REDEPLOY_URL")
if (!token) fail("missing RANCHER_DEPLOY_TOKEN")

execFileSync(process.execPath, ["scripts/build-push.js", "test"], {
  stdio: "inherit",
})

let url
try {
  url = new URL(redeployUrl)
} catch (error) {
  fail(`invalid RANCHER_REDEPLOY_URL: ${error.message}`)
}

const client = url.protocol === "http:" ? http : url.protocol === "https:" ? https : null
if (!client) fail(`unsupported Rancher URL protocol: ${url.protocol}`)

const request = client.request(
  {
    hostname: url.hostname,
    port: url.port || (url.protocol === "http:" ? 80 : 443),
    path: `${url.pathname}${url.search}`,
    method: "POST",
    rejectUnauthorized: !insecureTls,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": 0,
    },
    timeout: 30_000,
  },
  (response) => {
    let body = ""
    response.setEncoding("utf8")
    response.on("data", (chunk) => (body += chunk))
    response.on("end", () => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        fail(`Rancher redeploy failed: HTTP ${response.statusCode}\n${body}`)
      }

      console.log(`Test deployment triggered: HTTP ${response.statusCode}`)
      if (body) console.log(body)
    })
  },
)

request.on("timeout", () => request.destroy(new Error("request timed out")))
request.on("error", (error) => fail(`Rancher request failed: ${error.message}`))
request.end()
