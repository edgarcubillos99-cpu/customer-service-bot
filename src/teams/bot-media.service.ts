import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService // <-- Inyectamos ConfigService para Graph API
  ) {}

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
      
      let downloaded: DownloadedAttachment | null = null;

      // Interceptar text/html para extraer archivos de SharePoint (Canales de Teams)
      if (attachment.contentType === 'text/html') {
        const htmlContent = typeof attachment.content === 'string' 
          ? attachment.content 
          : JSON.stringify(attachment.content);
          
        // Buscar la URL de SharePoint incrustada
        const sharepointUrlMatch = htmlContent?.match(/href="(https:\/\/[a-zA-Z0-9-]+\.sharepoint\.com\/[^"]+)"/i);
        
        if (sharepointUrlMatch && sharepointUrlMatch[1]) {
          this.logger.log(`🔗 Enlace de SharePoint detectado, descargando vía Graph API...`);
          downloaded = await this.downloadSharePointFile(sharepointUrlMatch[1]);
        } else {
          this.logger.log(`⏩ Ignorando adjunto HTML normal (sin archivo)`);
          continue;
        }
      }
      // Ignorar tarjetas UI
      else if (this.isNonFileAttachment(attachment)) {
        this.logger.log(`⏩ Ignorando adjunto no descargable (${attachment.contentType})`);
        continue;
      }
      // CASO A: Archivos nativos de Bot Framework (Chats 1:1)
      else if (attachment.contentType === 'application/vnd.microsoft.teams.file.download.info') {
        downloaded = await this.downloadTeamsInfoFile(attachment);
      }
      // CASO B: Archivos de Canales (PDFs, Excel, Docs, Imágenes adjuntas copiadas en línea)
      else if (attachment.contentUrl) {
        downloaded = await this.downloadGenericFile(attachment, botToken);
      }

      if (downloaded) {
        attachments.push(downloaded);
      } else {
        this.logger.warn(`❌ No se pudo descargar: ${attachment.name || 'Archivo'}.`);
      }
    }

    return attachments;
  }

  /**
   * Obtiene un token de acceso para Microsoft Graph API usando Client Credentials
   */
  private async getGraphToken(): Promise<string | null> {
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');
    const clientId = this.configService.get<string>('MICROSOFT_APP_ID');
    const clientSecret = this.configService.get<string>('MICROSOFT_APP_PASSWORD');

    if (!tenantId || !clientId || !clientSecret) {
      this.logger.error('❌ Faltan credenciales para Graph API en las variables de entorno');
      return null;
    }

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'client_credentials');

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
      return response.data.access_token;
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo token Graph: ${error.message}`);
      return null;
    }
  }

  /**
   * Descarga un archivo directamente desde SharePoint usando Graph API
   */
  private async downloadSharePointFile(sharePointUrl: string): Promise<DownloadedAttachment | null> {
    try {
      const token = await this.getGraphToken();
      if (!token) return null;

      // 1. Codificar la URL al formato "sharing token" que exige Microsoft Graph
      const base64Value = Buffer.from(sharePointUrl).toString('base64');
      const encodedUrl = 'u!' + base64Value.replace(/=/g, '').replace(/\//g, '_').replace(/\+/g, '-');

      // 2. Obtener metadatos del archivo
      const driveItemUrl = `https://graph.microsoft.com/v1.0/shares/${encodedUrl}/driveItem`;
      const metaResponse = await firstValueFrom(
        this.httpService.get(driveItemUrl, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
      
      const fileData = metaResponse.data;
      const downloadUrl = fileData['@microsoft.graph.downloadUrl'];
      const fileName = fileData.name || `archivo_${Date.now()}`;
      const mimeType = fileData.file?.mimeType || this.inferMimeType(fileName);

      if (!downloadUrl) {
        this.logger.error('❌ No se encontró URL de descarga en SharePoint');
        return null;
      }

      this.logger.log(`📥 Descargando binario de SharePoint: ${fileName}`);
      
      // 3. Descargar el archivo real
      const fileResponse = await firstValueFrom(
        this.httpService.get(downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 45000
        })
      );

      return {
        buffer: Buffer.from(fileResponse.data),
        contentType: mimeType,
        name: fileName,
      };
    } catch (error: any) {
      this.logger.error(`❌ Error descargando desde SharePoint: ${error.response?.data?.error?.message || error.message}`);
      return null;
    }
  }

  private async downloadTeamsInfoFile(attachment: Attachment): Promise<DownloadedAttachment | null> {
    try {
      let contentObj = attachment.content;
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

  private async downloadGenericFile(attachment: Attachment, token: string): Promise<DownloadedAttachment | null> {
    try {
      const url = attachment.contentUrl;
      if (!url) return null;

      const fileName = attachment.name || `archivo_${Date.now()}`;
      this.logger.log(`📥 Descargando archivo genérico (PDF/Doc/Adjunto): ${fileName}`);

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await firstValueFrom(this.httpService.get(url, { headers, responseType: 'arraybuffer', timeout: 45000 }));

      return {
        buffer: Buffer.from(response.data),
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
      'application/vnd.microsoft.card.signin'
      // ¡IMPORTANTE! Eliminé 'text/html' de aquí para que el bucle principal no lo bloquee.
    ];
    return nonFileTypes.some(type => 
      attachment.contentType === type || 
      attachment.contentType?.startsWith(type)
    );
  }
}