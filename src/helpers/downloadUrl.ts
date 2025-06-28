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
    const config = {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificate: true,
      youtubeSkipDashManifest: true,
      noPlaylist: true,
      format: downloadJob.audio
        ? 'bestaudio[filesize<=2G]/bestaudio[filesize_approx<=2G]/bestaudio/best[filesize<=2G]/best[filesize_approx<=2G]/best'
        : 'best[filesize<=2G][ext=mp4]/best[filesize_approx<=2G][ext=mp4]/best[filesize<=2G]/best[filesize_approx<=2G]/best',
      maxFilesize: '2048m',
      noCallHome: true,
      noProgress: true,
      output: `${tempDir}/${fileUuid}.%(ext)s`,
      mergeOutputFormat: 'mkv',
      noCacheDir: true,
      noPart: true,
      cookies: resolve(cwd(), 'cookie'),
      recodeVideo: 'mp4',
      ignoreErrors: true,
    }

    let downloadedFileInfo: DownloadedFileInfo
    try {
      downloadedFileInfo = await youtubedl(downloadJob.url, config)
    } catch (infoError) {
      // If title extraction fails, try without dump-single-json
      console.log('Failed to extract info, trying direct download...')
      downloadedFileInfo = {
        title: 'Downloaded Video',
        ext: downloadJob.audio ? 'mp3' : 'mp4',
      } as DownloadedFileInfo
    }

    const title = downloadedFileInfo.title || 'Downloaded Video'
    const ext =
      downloadedFileInfo.ext ||
      downloadedFileInfo.entries?.[0]?.ext ||
      (downloadJob.audio ? 'mp3' : 'mp4')
    const escapedTitle = (title || '').replace('<', '&lt;').replace('>', '&gt;')
    const filePath = `${tempDir}/${fileUuid}.${ext}`
    await youtubedl(downloadJob.url, omit(config, 'dumpSingleJson'))
    // ...existing code...
  } catch (error) {
    if (downloadJob.status === DownloadJobStatus.downloading) {
      if (error instanceof Error) {
        if (error.message.includes('Unsupported URL')) {
          downloadJob.status = DownloadJobStatus.unsupportedUrl
        } else if (
          error.message.includes('Requested format is not available')
        ) {
          downloadJob.status = DownloadJobStatus.noSuitableVideoSize
        } else if (error.message.includes('Unable to extract title')) {
          downloadJob.status = DownloadJobStatus.failedDownload
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
