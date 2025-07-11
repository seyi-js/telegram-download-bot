/* eslint-disable sort-imports-es6-autofix/sort-imports-es6 */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable prettier/prettier */
import * as rimraf from 'rimraf'
import { DocumentType } from '@typegoose/typegoose'
import { InputFile } from 'grammy'
import { cwd } from 'process'
import { findOrCreateChat } from '@/models/Chat'
import { findOrCreateUrl } from '@/models/Url'
import { omit } from 'lodash'
import { resolve } from 'path'
import { v4 as uuid } from 'uuid'
import DownloadJob from '@/models/DownloadJob'
import DownloadJobStatus from '@/models/DownloadJobStatus'
import DownloadedFileInfo from '@/models/DownloadedFileInfo'
import env from '@/helpers/env'
import getThumbnailUrl from '@/helpers/getThumbnailUrl'
import report from '@/helpers/report'
import sendCompletedFile from '@/helpers/sendCompletedFile'
import unlincSyncSafe from '@/helpers/unlincSyncSafe'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const youtubedl = require('youtube-dl-exec')

export default async function downloadUrl(
  downloadJob: DocumentType<DownloadJob>
) {
  const fileUuid = uuid()
  const tempDir = env.isDevelopment
    ? resolve(cwd(), 'output')
    : '/var/tmp/video-download-bot'
  try {
    console.log(`Downloading url ${downloadJob.url}`)
    // Download
    const config = {
      // dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificate: true,
      youtubeSkipDashManifest: true,
      noPlaylist: true,
      format: downloadJob.audio
        ? 'bestaudio/best[acodec!=none]/best'
        : 'best[height<=720]/best[height<=1080]/hls-742/720p/480p/best',
      maxFilesize: '2048m',
      noCallHome: true,
      noProgress: true,
      output: `${tempDir}/${fileUuid}.%(ext)s`,
      mergeOutputFormat: 'mkv',
      noCacheDir: true,
      noPart: true,
      cookies: resolve(cwd(), 'cookie'),
      // cookiesFromBrowser: 'chrome',
      recodeVideo: 'mp4',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // addHeader: [
      //   'Accept-Language:en-US,en;q=0.9',
      //   'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      //   'Referer:https://www.pornhub.com/',
      // ],
    }

    const downloadedFileInfo: DownloadedFileInfo = await youtubedl(
      downloadJob.url,
      {
        // listFormats: true,
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificate: true,
        cookies: resolve(cwd(), 'cookie'),
        // cookiesFromBrowser: 'chrome',
      }
      // config
    )

    console.log(`Downloaded file info: ${JSON.stringify(downloadedFileInfo)}`)

    const title = downloadedFileInfo.title
    const ext =
      downloadedFileInfo.ext || downloadedFileInfo.entries?.[0]?.ext || 'mkv'
    const escapedTitle = (title || '').replace('<', '&lt;').replace('>', '&gt;')
    const filePath = `${tempDir}/${fileUuid}.${ext}`
    await youtubedl(downloadJob.url, config)
    // Upload
    downloadJob.status = DownloadJobStatus.uploading
    await downloadJob.save()
    const file = new InputFile(filePath)
    const { doc: originalChat } = await findOrCreateChat(
      downloadJob.originalChatId
    )
    // const thumb = await getThumbnailUrl(downloadedFileInfo, filePath)
    const fileId = await sendCompletedFile(
      downloadJob.originalChatId,
      downloadJob.originalMessageId,
      originalChat.language,
      downloadJob.audio,
      escapedTitle,
      file,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      undefined
    )
    // Cleanup
    await unlincSyncSafe(filePath)
    // await unlincSyncSafe(thumb)

    // Finished
    await findOrCreateUrl(
      downloadJob.url,
      fileId,
      downloadJob.audio,
      escapedTitle || 'No title'
    )
    downloadJob.status = DownloadJobStatus.finished
    await downloadJob.save()
  } catch (error) {
    console.log(error)
    if (downloadJob.status === DownloadJobStatus.downloading) {
      if (error instanceof Error) {
        if (error.message.includes('Unsupported URL')) {
          downloadJob.status = DownloadJobStatus.unsupportedUrl
        } else if (
          error.message.includes('Requested format is not available')
        ) {
          downloadJob.status = DownloadJobStatus.noSuitableVideoSize
        } else {
          downloadJob.status = DownloadJobStatus.failedDownload
        }
      }
    } else if (downloadJob.status === DownloadJobStatus.uploading) {
      downloadJob.status = DownloadJobStatus.failedUpload
    }
    await downloadJob.save()
    report(error, { location: 'downloadUrl', meta: downloadJob.url })
  } finally {
    rimraf(`${tempDir}/${fileUuid}*`, (error) => {
      if (error) {
        report(error, { location: 'deleting temp files' })
      }
    })
  }
}
