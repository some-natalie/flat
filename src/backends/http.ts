import * as core from '@actions/core'
import { HTTPConfig } from '../config.js'
import fs from 'fs'
import axios, { AxiosResponse } from 'axios'
import { pipeline } from 'stream/promises'

export default async function fetchHTTP(config: HTTPConfig): Promise<string> {
  core.info('Fetching: HTTP')

  // Authorization headers
  const auth = {
    authorization: config.authorization,
  }
  const authHeader = config.authorization ? auth : {}

  let response: AxiosResponse<any>

  try {
    if (config.axios_config) {
      const axiosConfig = fs.readFileSync(config.axios_config, {
        encoding: 'utf8',
      })

      const parsed = JSON.parse(axiosConfig)

      const combinedWithOtherConfigValues = {
        ...parsed,
        url: config.http_url,
        baseURL: undefined,
        headers: {
          ...parsed.headers,
          ...authHeader,
        },
        responseType: 'stream',
      }

      response = await axios(combinedWithOtherConfigValues)
    } else {
      response = await axios.get(config.http_url, {
        method: 'get',
        responseType: 'stream',
        headers: {
          ...authHeader,
        },
      })
    }
    const filename = config.downloaded_filename
    const writer = fs.createWriteStream(filename)

    await pipeline(response.data, writer)
    return filename
  } catch (error) {
    core.setFailed(error instanceof Error ? error : String(error))
    throw error
  }
}
