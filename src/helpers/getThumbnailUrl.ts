/* eslint-disable prettier/prettier */
import * as sharp from 'sharp'
import * as uuid from 'uuid'
import { createWriteStream } from 'fs'
import { cwd } from 'process'
import { get } from 'https'
import { get as httpGet } from 'http'
import { resolve } from 'path'
import DownloadedFileInfo from '@/models/DownloadedFileInfo'
import env from '@/helpers/env'
import unlincSyncSafe from '@/helpers/unlincSyncSafe'
import ffmpeg = require('fluent-ffmpeg')

const tempDir = env.isDevelopment
  ? resolve(cwd(), 'output')
  : '/var/tmp/video-download-bot'

export default async function getThumbnailUrl(
  downloadedFileInfo: DownloadedFileInfo,
  videoPath: string
) {
  let thumbnailUrl = ''
  const thumbnailUuid = uuid.v4()
  for (const thumbnail of downloadedFileInfo.thumbnails?.reverse() || []) {
    if (thumbnail.height && thumbnail.width) {
      thumbnailUrl = thumbnail.url
      break
    }
  }

  let thumbnailPath = ''
  if (!thumbnailUrl) {
    const thumbName = `${thumbnailUuid}.jpeg`
    thumbnailPath = resolve(tempDir, thumbName)
    await makeThumbnail(videoPath, thumbName)
  } else {
    thumbnailPath = await downloadThumbnail(thumbnailUrl, thumbnailUuid)
  }
  const outputPath = resolve(tempDir, `${thumbnailUuid}-resized.jpeg`)
  const thumbPathDone = await resizeThumb(thumbnailPath, outputPath)
  unlincSyncSafe(thumbnailPath)
  return thumbPathDone
}

function downloadThumbnail(url: string, id: string): Promise<string> {
  const destFile = resolve(tempDir, `${id}`)

  return new Promise((resolve, reject) => {
    const file = createWriteStream(destFile)
    const request = url.startsWith('https') ? get : httpGet

    request(url, (response) => {
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve(destFile)
      })
    }).on('error', (error) => {
      reject(error)
    })
  })
}

function makeThumbnail(videoPath: string, filename: string) {
  return new Promise<void>((res, rej) => {
    ffmpeg(videoPath)
      .thumbnail({
        timestamps: ['50%'],
        filename,
        folder: tempDir,
      })
      .on('error', (error) => {
        rej(error)
      })
      .on('end', () => res())
  })
}

async function resizeThumb(inputPath: string, outputPath: string) {
  await sharp(inputPath)
    .resize({ width: 320, height: 320, fit: sharp.fit.contain })
    .toFormat('jpeg')
    .toFile(outputPath)
  return outputPath
}
