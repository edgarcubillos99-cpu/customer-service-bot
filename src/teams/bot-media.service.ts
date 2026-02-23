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

  async downloadAllAttachments(turnContext: TurnContext): Promise<DownloadedAttachment[]> {
    const activity = turnContext.activity;
    const attachments: DownloadedAttachment[] = [];

    if (!activity.attachments || activity.attachments.length === 0) {
      return attachments;
    }

    // 1. EXTRAER EL TOKEN DEL BOT: Vital para descargar imágenes nativas y recursos protegidos
    let botToken = '';
    try {
      const connectorClient = turnContext.turnState.get(turnContext.adapter.ConnectorClientKey);
      if (connectorClient && connectorClient.credentials) {
         botToken = await connectorClient.credentials.getToken();
      }
    } catch (err) {
      this.logger.warn('No se pudo obtener el token del bot del contexto.');
    }

    for (const attachment of activity.attachments) {
      // Ignorar únicamente Adaptive Cards y tarjetas UI puras
      if (this.isNonFileAttachment(attachment)) {
        continue;
      }

      let downloaded: DownloadedAttachment | null = null;

      // 2A. CASO DOCUMENTOS/PDFs: Archivos subidos al canal (SharePoint/OneDrive info)
      if (attachment.contentType === 'application/vnd.microsoft.teams.file.download.info') {
         downloaded = await this.downloadTeamsFile(attachment);
      }
      // 2B. CASO IMÁGENES: Imágenes pegadas directamente en el chat
      else if (attachment.contentType.startsWith('image/') || attachment.contentUrl) {
         downloaded = await this.downloadInlineAttachment(attachment, botToken);
      }

      if (downloaded) {
        attachments.push(downloaded);
      }
    }

    return attachments;
  }

  private async downloadTeamsFile(attachment: Attachment): Promise<DownloadedAttachment | null> {
    try {
      const downloadInfo = attachment.content as { downloadUrl?: string; name?: string };
      const url = downloadInfo?.downloadUrl;
      const fileName = attachment.name || downloadInfo?.name || `documento_${Date.now()}.pdf`;

      if (!url) return null;

      this.logger.log(`📥 Descargando archivo PDF/Doc de Teams: ${fileName}`);

      // Generalmente downloadUrl ya viene pre-autenticado
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer',
          timeout: 45000, // Aumentamos el timeout para PDFs pesados
        }),
      );

      return {
        buffer: Buffer.from(response.data),
        contentType: attachment.contentType !== 'application/vnd.microsoft.teams.file.download.info' 
                      ? attachment.contentType 
                      : this.inferMimeType(fileName) || 'application/octet-stream',
        name: fileName,
      };
    } catch (error: any) {
      this.logger.error(`❌ Error descargando archivo de Teams: ${error.message}`);
      return null;
    }
  }

  private async downloadInlineAttachment(attachment: Attachment, token: string): Promise<DownloadedAttachment | null> {
    try {
      const url = attachment.contentUrl;
      if (!url) return null;

      const fileName = attachment.name || `imagen_${Date.now()}.jpg`;
      this.logger.log(`🖼️ Descargando imagen inline: ${fileName}`);

      const headers: Record<string, string> = {};
      // Inyectar el token OAuth del bot para brincar la seguridad de Teams
      if (token) {
        headers['Authorization'] = `Bearer ${token}`; 
      }

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers,
          responseType: 'arraybuffer',
          timeout: 30000,
        }),
      );

      return {
        buffer: Buffer.from(response.data),
        contentType: attachment.contentType || this.inferMimeType(fileName) || 'image/jpeg',
        name: fileName,
      };
    } catch (error: any) {
      this.logger.error(`❌ Error descargando adjunto inline: ${error.message}`);
      return null;
    }
  }

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

  private isNonFileAttachment(attachment: Attachment): boolean {
    const nonFileTypes = [
      'application/vnd.microsoft.card.adaptive',
      'application/vnd.microsoft.card.hero',
      'application/vnd.microsoft.card.thumbnail',
      'application/vnd.microsoft.card.signin',
      'text/html',
      // ¡ELIMINAMOS 'image/*' de aquí para permitir que pasen las imágenes!
    ];
    return nonFileTypes.some(type => 
      attachment.contentType === type || 
      attachment.contentType?.startsWith(type.replace('*', ''))
    );
  }
}