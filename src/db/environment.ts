type DatabaseEnvironmentKey =
  | "DB_HOST"
  | "DB_PORT"
  | "DB_NAME"
  | "DB_USER"
  | "DB_PASSWORD"

function getRequiredEnvironment(
  environment: NodeJS.ProcessEnv,
  key: DatabaseEnvironmentKey
) {
  const value = environment[key]?.trim()

  if (!value) {
    throw new Error(`Missing required database environment variable: ${key}`)
  }

  return value
}

export function getDatabaseConnectionConfig(
  environment: NodeJS.ProcessEnv = process.env
) {
  const portValue = getRequiredEnvironment(environment, "DB_PORT")
  const port = Number(portValue)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535")
  }

  return {
    host: getRequiredEnvironment(environment, "DB_HOST"),
    port,
    database: getRequiredEnvironment(environment, "DB_NAME"),
    user: getRequiredEnvironment(environment, "DB_USER"),
    password: getRequiredEnvironment(environment, "DB_PASSWORD"),
  }
}
