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

    // 1. EXTRAER EL TOKEN DEL BOT: Esencial para descargar archivos protegidos de Canales
    let botToken = '';
    try {
      const connectorClient = turnContext.turnState.get(turnContext.adapter.ConnectorClientKey);
      if (connectorClient && connectorClient.credentials) {
         botToken = await connectorClient.credentials.getToken();
      }
    } catch (err) {
      this.logger.warn('⚠️ No se pudo obtener el token del bot del contexto.');
    }

    this.logger.log(`📦 Analizando ${activity.attachments.length} adjuntos de Teams`);

    for (const attachment of activity.attachments) {
      this.logger.log(`🔍 Evaluando adjunto: Name=${attachment.name}, ContentType=${attachment.contentType}`);
      
      // Ignorar tarjetas UI
      if (this.isNonFileAttachment(attachment)) {
        this.logger.log(`⏩ Ignorando adjunto no descargable (${attachment.contentType})`);
        continue;
      }

      let downloaded: DownloadedAttachment | null = null;

      // CASO A: Archivos nativos de Bot Framework (Chats 1:1)
      if (attachment.contentType === 'application/vnd.microsoft.teams.file.download.info') {
        downloaded = await this.downloadTeamsInfoFile(attachment);
      }
      // CASO B: Archivos de Canales (PDFs, Excel, Docs, Imágenes adjuntas)
      else if (attachment.contentUrl) {
        downloaded = await this.downloadGenericFile(attachment, botToken);
      }

      if (downloaded) {
        attachments.push(downloaded);
      } else {
        this.logger.warn(`❌ No se pudo descargar: ${attachment.name}. Imprimiendo payload para depuración:`);
        this.logger.debug(JSON.stringify(attachment, null, 2));
      }
    }

    return attachments;
  }

  /**
   * Descarga archivos de tipo FileDownloadInfo
   */
  private async downloadTeamsInfoFile(attachment: Attachment): Promise<DownloadedAttachment | null> {
    try {
      let contentObj = attachment.content;
      // Teams a veces serializa el objeto en un string
      if (typeof contentObj === 'string') {
        try { contentObj = JSON.parse(contentObj); } catch(e){}
      }

      const url = contentObj?.downloadUrl;
      const fileName = attachment.name || contentObj?.name || `archivo_${Date.now()}`;

      if (!url) return null;

      this.logger.log(`📥 Descargando FileDownloadInfo: ${fileName}`);
      const response = await firstValueFrom(this.httpService.get(url, { responseType: 'arraybuffer', timeout: 45000 }));
      
      return {
        buffer: Buffer.from(response.data),
        contentType: this.inferMimeType(fileName),
        name: fileName,
      };
    } catch (error: any) {
      this.logger.error(`Error en downloadTeamsInfoFile: ${error.message}`);
      return null;
    }
  }

  /**
   * Descarga archivos adjuntos de canales usando el Token del Bot
   */
  private async downloadGenericFile(attachment: Attachment, token: string): Promise<DownloadedAttachment | null> {
    try {
      const url = attachment.contentUrl;
      if (!url) return null;

      const fileName = attachment.name || `archivo_${Date.now()}`;
      this.logger.log(`📥 Descargando archivo genérico (PDF/Doc/Adjunto): ${fileName}`);

      const headers: Record<string, string> = {};
      // Inyectar autorización para brincar la seguridad de Teams
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await firstValueFrom(this.httpService.get(url, { headers, responseType: 'arraybuffer', timeout: 45000 }));

      return {
        buffer: Buffer.from(response.data),
        // Si no viene contentType o es octet-stream, lo inferimos por el nombre
        contentType: attachment.contentType && attachment.contentType !== 'application/octet-stream' 
                     ? attachment.contentType 
                     : this.inferMimeType(fileName),
        name: fileName,
      };
    } catch (error: any) {
      this.logger.error(`Error en downloadGenericFile: ${error.message}`);
      return null;
    }
  }

  private inferMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      mp4: 'video/mp4', pdf: 'application/pdf', doc: 'application/msword',
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
      'text/html' // No bloqueamos 'image/*' aquí para permitir su descarga
    ];
    return nonFileTypes.some(type => 
      attachment.contentType === type || 
      attachment.contentType?.startsWith(type)
    );
  }
}