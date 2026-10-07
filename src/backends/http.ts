import * as core from '@actions/core'
import { HTTPConfig } from '../config.js'
import fs from 'fs'
import axios from 'axios'
import { pipeline } from 'stream/promises'

export default async function fetchHTTP(config: HTTPConfig): Promise<string> {
  core.info('Fetching: HTTP')

  // Authorization headers
  const auth = {
    authorization: config.authorization,
  }
  const authHeader = config.authorization ? auth : {}

  try {
    const response = await axios.get(config.http_url, {
      responseType: 'stream',
      headers: authHeader,
    })
    const filename = config.downloaded_filename
    const writer = fs.createWriteStream(filename)

    await pipeline(response.data, writer)
    return filename
  } catch (error) {
    core.setFailed(error instanceof Error ? error : String(error))
    throw error
  }
}
