import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { TurnContext, Attachment } from 'botbuilder';
import { firstValueFrom } from 'rxjs';

export interface DownloadedAttachment {
  buffer: Buffer;
  contentType: string;
  name: string;
}

@Injectable()
export class BotMediaService {
  private readonly logger = new Logger(BotMediaService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Descarga todos los archivos adjuntos de un mensaje de Teams
   * NOTA: Las imágenes pegadas directamente en Teams tienen URLs protegidas
   * que no se pueden descargar fácilmente. Solo funcionan archivos adjuntados
   * con el botón de "Adjuntar".
   */
  async downloadAllAttachments(turnContext: TurnContext): Promise<DownloadedAttachment[]> {
    const activity = turnContext.activity;
    const attachments: DownloadedAttachment[] = [];

    if (!activity.attachments || activity.attachments.length === 0) {
      return attachments;
    }

    for (const attachment of activity.attachments) {
      // Ignorar cards y tipos no descargables
      if (this.isNonFileAttachment(attachment)) {
        continue;
      }

      // Solo procesar FileDownloadInfo (archivos adjuntados con el botón)
      if (attachment.contentType === 'application/vnd.microsoft.teams.file.download.info') {
        const downloaded = await this.downloadFileAttachment(attachment);
        if (downloaded) {
          attachments.push(downloaded);
        }
      }
    }

    return attachments;
  }

  /**
   * Descarga un archivo adjunto que viene como FileDownloadInfo
   */
  private async downloadFileAttachment(attachment: Attachment): Promise<DownloadedAttachment | null> {
    try {
      const downloadInfo = attachment.content as { downloadUrl?: string; name?: string };
      const url = downloadInfo?.downloadUrl;
      const fileName = attachment.name || downloadInfo?.name || 'archivo';

      if (!url) {
        this.logger.warn(`Adjunto sin URL de descarga: ${fileName}`);
        return null;
      }

      this.logger.log(`Descargando archivo de Teams: ${fileName}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
        }),
      );

      const buffer = Buffer.from(response.data);
      const contentType = attachment.contentType || this.inferMimeType(fileName);

      this.logger.log(`✅ Archivo descargado: ${fileName} (${buffer.length} bytes)`);

      return {
        buffer,
        contentType,
        name: fileName,
      };
    } catch (error: any) {
      this.logger.error(`Error descargando archivo de Teams: ${error.message}`);
      return null;
    }
  }

  /**
   * Infiere el MIME type basándose en la extensión
   */
  private inferMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Verifica si el attachment no es un archivo descargable
   */
  private isNonFileAttachment(attachment: Attachment): boolean {
    const nonFileTypes = [
      'application/vnd.microsoft.card.adaptive',
      'application/vnd.microsoft.card.hero',
      'application/vnd.microsoft.card.thumbnail',
      'application/vnd.microsoft.card.signin',
      'text/html',
      'image/*', // Imágenes inline no son descargables fácilmente
    ];
    return nonFileTypes.some(type => 
      attachment.contentType === type || 
      attachment.contentType?.startsWith(type.replace('*', ''))
    );
  }
}
