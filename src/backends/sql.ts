import * as core from '@actions/core'
import { ConnectionString } from 'connection-string'
import { createWriteStream, readFileSync, writeFileSync } from 'fs'
import { DataSource, DataSourceOptions, DatabaseType } from 'typeorm'
import { SQLConfig } from '../config.js'
import { stringify } from 'csv-stringify'
import { pipeline } from 'stream/promises'
import mssql from 'mssql'
import mysql from 'mysql2'
import pg from 'pg'
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js'

// Explicit imports keep TypeORM's dynamically loaded drivers in the action bundle.
const DRIVERS: Partial<Record<DatabaseType, unknown>> = {
  mysql,
  mariadb: mysql,
  postgres: pg,
  cockroachdb: pg,
  mssql,
  sqljs: initSqlJs,
}

// TODO: wish there was a dynamic way to import this for runtime usage from the DatabaseType type
const TYPEORM_PROTOCOLS = [
  'mysql',
  'postgres',
  'cockroachdb',
  'sap',
  'mariadb',
  'cordova',
  'react-native',
  'nativescript',
  'sqljs',
  'oracle',
  'mssql',
  'mongodb',
  'aurora-mysql',
  'aurora-postgres',
  'expo',
  'better-sqlite3',
  'capacitor',
  'spanner',
] satisfies DatabaseType[]

const PROTOCOL_ALIASES: Record<string, DatabaseType> = {
  sqlite: 'sqljs',
  'aurora-data-api': 'aurora-mysql',
  'aurora-data-api-pg': 'aurora-postgres',
}

function isValidDatabaseType(protocol: string): protocol is DatabaseType {
  return (TYPEORM_PROTOCOLS as readonly string[]).includes(protocol)
}

export default async function fetchSQL(config: SQLConfig): Promise<string> {
  core.info('Fetching: SQL')
  let connection: DataSource
  let query

  core.debug('Reading query file')
  try {
    core.debug(`SQL Query file path: ${config.sql_queryfile}`)
    query = readFileSync(config.sql_queryfile, { encoding: 'utf8' })
  } catch (error) {
    core.setFailed(
      `Unable to read queryfile ${config.sql_queryfile}: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }

  core.debug('Connecting to database')
  const parsed = new ConnectionString(config.sql_connstring)
  try {
    const rawProtocol = parsed.protocol
    const protocol = rawProtocol
      ? PROTOCOL_ALIASES[rawProtocol] || rawProtocol
      : undefined
    if (!protocol) {
      throw new Error(
        'Unable to determine the database protocol from the connection string',
      )
    }
    if (!isValidDatabaseType(protocol)) {
      throw new Error(
        `The '${protocol}' protocol is not supported. Please choose one of: ${TYPEORM_PROTOCOLS.join(
          ', ',
        )}`,
      )
    }

    let userProvidedConfiguration: Record<string, unknown> = {}

    try {
      const configuration = config.typeorm_config
        ? JSON.parse(config.typeorm_config)
        : {}
      if (
        !configuration ||
        typeof configuration !== 'object' ||
        Array.isArray(configuration)
      ) {
        throw new Error('TypeORM configuration must be a JSON object')
      }
      userProvidedConfiguration = configuration
    } catch (error) {
      throw new Error(
        'Failed to parse JSON string containing TypeORM DataSource options',
        { cause: error },
      )
    }

    const options = {
      url: config.sql_connstring,
      ...userProvidedConfiguration,
      type: (userProvidedConfiguration.type ?? protocol) as
        DatabaseType | 'sqlite',
      driver:
        userProvidedConfiguration.driver ??
        DRIVERS[
          (userProvidedConfiguration.type === 'sqlite'
            ? 'sqljs'
            : (userProvidedConfiguration.type ?? protocol)) as DatabaseType
        ],
    }
    if (options.type === 'sqlite' || options.type === 'sqljs') {
      const database = userProvidedConfiguration.database
      connection = new DataSource({
        ...options,
        type: 'sqljs',
        ...(typeof database === 'string'
          ? { database: undefined, location: database, autoSave: true }
          : {}),
        sqlJsConfig: {
          wasmBinary: readFileSync(
            new URL(
              '../../node_modules/sql.js/dist/sql-wasm.wasm',
              import.meta.url,
            ),
          ),
          ...(userProvidedConfiguration.sqlJsConfig as object),
        },
      } as DataSourceOptions)
    } else {
      connection = new DataSource(options as DataSourceOptions)
    }
    await connection.initialize()
  } catch (error) {
    core.setFailed(
      `Unable to connect to database: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }

  core.info('Querying database')
  let result
  try {
    result = await connection.query(query)
  } catch (error) {
    core.setFailed(
      `Unable to query database: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  } finally {
    core.info('Closing database')
    await connection.destroy()
  }

  const outfile = `${config.downloaded_filename}`
  const sqlFormat = outfile.split('.').pop() // should be csv or json
  try {
    switch (sqlFormat) {
      case 'csv':
        core.info('Writing CSV')
        const writer = createWriteStream(outfile, { encoding: 'utf8' })
        await pipeline(stringify(result, { header: true }), writer)
        break

      default:
        core.info('Writing JSON')
        writeFileSync(outfile, JSON.stringify(result))
    }
    return outfile
  } catch (error) {
    core.setFailed(
      `Unable to write results to ${outfile}: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}
