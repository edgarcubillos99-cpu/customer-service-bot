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
      let sharepointUrl: string | null = null;

      // 1) CASO PREFERIDO: contentUrl con SharePoint (adjunto como referencia en canal)
      if (attachment.contentUrl && attachment.contentUrl.includes('.sharepoint.com')) {
        sharepointUrl = attachment.contentUrl;
      }
      // 2) CASO text/html: extraer URL de SharePoint O imagen incrustada (captura, imagen pegada, etc.)
      if (!sharepointUrl && attachment.contentType === 'text/html') {
        const htmlContent = typeof attachment.content === 'string' 
          ? attachment.content 
          : JSON.stringify(attachment.content ?? '');
        sharepointUrl = this.extractSharePointUrlFromHtml(htmlContent);
        if (sharepointUrl) {
          this.logger.log(`🔗 Enlace de SharePoint detectado en HTML, descargando vía Graph API...`);
        } else {
          // Si en el mismo mensaje ya hay un adjunto image/* con contentUrl, no procesar este HTML (evitar duplicado)
          const hasImageAttachment = activity.attachments?.some(
            (a: Attachment) => a !== attachment && a.contentUrl && (a.contentType === 'image/*' || a.contentType?.startsWith('image/'))
          );
          if (hasImageAttachment) {
            this.logger.log(`⏩ Omitiendo adjunto HTML (la imagen ya viene en otro adjunto del mensaje)`);
            continue;
          }
          // No es SharePoint: puede ser una imagen incrustada (captura, imagen pegada en canal)
          downloaded = await this.downloadFromHtmlAttachment(attachment, htmlContent, botToken);
          if (!downloaded) {
            // Fallback: imagen puede estar en hostedContents de Graph (imagen pegada en cuerpo)
            downloaded = await this.tryDownloadHostedContentsFromGraph(activity);
          }
          if (downloaded) {
            attachments.push(downloaded);
            this.logger.log(`🖼️ Imagen/archivo extraída del adjunto HTML o Graph hostedContents`);
          } else {
            this.logger.log(`⏩ Ignorando adjunto HTML (sin URL de SharePoint ni imagen extraíble)`);
            this.logger.debug(`HTML recibido (primeros 1200 chars): ${htmlContent.slice(0, 1200)}`);
            this.logPayloadSummaryForDiagnostics(activity, attachment);
          }
          continue;
        }
      }

      if (sharepointUrl) {
        downloaded = await this.downloadSharePointFile(sharepointUrl);
        if (downloaded) {
          attachments.push(downloaded);
        } else {
          this.logger.warn(`❌ No se pudo descargar desde SharePoint: ${attachment.name || 'Archivo'}.`);
        }
        continue;
      }

      // Ignorar tarjetas UI
      if (this.isNonFileAttachment(attachment)) {
        this.logger.log(`⏩ Ignorando adjunto no descargable (${attachment.contentType})`);
        continue;
      }
      // CASO A: Archivos nativos de Bot Framework (Chats 1:1)
      if (attachment.contentType === 'application/vnd.microsoft.teams.file.download.info') {
        downloaded = await this.downloadTeamsInfoFile(attachment);
      }
      // CASO B: Archivos de Canales con contentUrl (PDF, etc.) sin SharePoint en la URL
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
      // text/html se maneja aparte para extraer SharePoint
    ];
    return nonFileTypes.some(type => 
      attachment.contentType === type || 
      attachment.contentType?.startsWith(type)
    );
  }

  /**
   * Extrae la primera URL de SharePoint encontrada en un string HTML.
   * Soporta: href con comillas dobles/simples, entidades HTML (&#58;, &#47;), y URLs sueltas.
   */
  private extractSharePointUrlFromHtml(htmlContent: string): string | null {
    if (!htmlContent || typeof htmlContent !== 'string') return null;

    const patterns: RegExp[] = [
      // href="https://...sharepoint.com/..."
      /href\s*=\s*["'](https:\/\/[a-zA-Z0-9-]+\.sharepoint\.com\/[^"'\s>]+)["']/i,
      // href con entidades HTML: https&#58;//... &#47; para /
      /href\s*=\s*["'](https(?:&#58;|&#x3a;|:)(?:\/|&#47;|&#x2f;|%2f)\/{0,2}[a-zA-Z0-9-]+\.sharepoint\.com(?:\/|&#47;|&#x2f;|%2f)[^"'\s>]+)["']/i,
      // Cualquier URL de SharePoint en el texto (sin href)
      /(https(?:&#58;|&#x3a;|:)(?:\/|&#47;|&#x2f;|%2f)\/{0,2}[a-zA-Z0-9-]+\.sharepoint\.com(?:\/|&#47;|&#x2f;|%2f)[^"'\s><]+)/i,
    ];

    for (const re of patterns) {
      const match = htmlContent.match(re);
      const raw = match ? (match[1] ?? match[0]) : null;
      if (raw) {
        const normalized = this.decodeHtmlEntitiesInUrl(raw.trim());
        if (normalized && /^https:\/\/[a-zA-Z0-9-]+\.sharepoint\.com\//i.test(normalized)) {
          return normalized;
        }
      }
    }
    return null;
  }

  /** Regex para validar GUID de Azure/Teams */
  private static readonly GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Obtiene el team ID como GUID desde channelData. Graph API exige un GUID, no el id de canal (19:xxx@thread.tacv2).
   * Si no viene en la actividad, usa TEAMS_TEAM_ID de la configuración.
   */
  private getTeamsTeamGuid(activity: any): string | null {
    const cd = activity?.channelData;
    let teamId: string | undefined;
    if (cd) {
      const fromActivity = cd.team?.id ?? cd.teamsTeamId;
      if (fromActivity && typeof fromActivity === 'string') {
        const trimmed = fromActivity.trim();
        if (BotMediaService.GUID_REGEX.test(trimmed)) return trimmed;
      }
    }
    const fromConfig = this.configService.get<string>('teamsTeamId');
    if (fromConfig && BotMediaService.GUID_REGEX.test(fromConfig.trim())) return fromConfig.trim();
    return null;
  }

  /**
   * Intenta descargar imágenes del mensaje desde Microsoft Graph (hostedContents).
   * Cuando el usuario pega una imagen en el cuerpo del mensaje, Teams no la envía en el adjunto
   * pero sí la guarda como hostedContent; Graph permite obtener los bytes.
   * Requiere permiso de aplicación: ChannelMessage.Read.All (o ChannelMessage.Read.Group con RSC).
   */
  private async tryDownloadHostedContentsFromGraph(activity: any): Promise<DownloadedAttachment | null> {
    // Graph exige team-id como GUID (ej: fbe2bf47-16c8-47cf-b4a5-4b9b187c508b). team.id suele ser el GUID.
    const teamId = this.getTeamsTeamGuid(activity);
    const channelId = activity.channelData?.teamsChannelId ?? activity.channelData?.channel?.id;
    const messageId = activity.id;
    if (!teamId || !channelId || !messageId) {
      this.logger.debug('[Graph hostedContents] Falta teamId (GUID), channelId o messageId en la actividad');
      return null;
    }

    const token = await this.getGraphToken();
    if (!token) return null;

    const baseUrl = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`;
    try {
      let listRes: any;
      try {
        listRes = await firstValueFrom(
          this.httpService.get(`${baseUrl}/hostedContents`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        );
      } catch (firstErr: any) {
        if (firstErr.response?.status === 404) {
          const convId = activity.conversation?.id as string;
          const rootMatch = convId?.match(/messageid=(\d+)/i);
          const rootId = rootMatch?.[1];
          if (rootId && rootId !== messageId) {
            const repliesUrl = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(rootId)}/replies/${encodeURIComponent(messageId)}/hostedContents`;
            listRes = await firstValueFrom(
              this.httpService.get(repliesUrl, { headers: { Authorization: `Bearer ${token}` } })
            );
            if (listRes?.data?.value) {
              (listRes as any).__repliesBase = `${repliesUrl.replace('/hostedContents', '')}`;
            }
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      const items = listRes?.data?.value;
      const repliesBase = (listRes as any).__repliesBase;
      const baseForValue = repliesBase || baseUrl;
      if (!Array.isArray(items) || items.length === 0) return null;

      for (const item of items) {
        const id = item.id;
        if (!id) continue;
        try {
          const valueRes = await firstValueFrom(
            this.httpService.get(`${baseForValue}/hostedContents/${encodeURIComponent(id)}/$value`, {
              headers: { Authorization: `Bearer ${token}` },
              responseType: 'arraybuffer',
              timeout: 15000,
            })
          );
          const buffer = Buffer.from(valueRes.data);
          if (buffer.length === 0) continue;
          const contentType = (valueRes.headers['content-type'] as string) || 'application/octet-stream';
          const isImage = contentType.startsWith('image/');
          const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
          this.logger.log(`📥 Descargado hostedContent desde Graph: ${contentType}, ${buffer.length} bytes`);
          return {
            buffer,
            contentType,
            name: isImage ? `imagen.${ext}` : `archivo.${ext}`,
          };
        } catch (err: any) {
          this.logger.debug(`[Graph hostedContents] Error al obtener contenido ${id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      if (err.response?.status === 404) {
        this.logger.debug('[Graph hostedContents] Mensaje o canal no encontrado (¿mensaje en hilo/reply?)');
      } else {
        this.logger.warn(`[Graph hostedContents] ${err.response?.data?.error?.message || err.message}`);
      }
    }
    return null;
  }

  /**
   * Intenta obtener un archivo/imagen desde un adjunto text/html cuando no hay URL de SharePoint.
   * Soporta: contentUrl del adjunto, img src con data:image/...;base64,..., img src con URL.
   */
  private async downloadFromHtmlAttachment(
    attachment: Attachment,
    htmlContent: string,
    botToken: string
  ): Promise<DownloadedAttachment | null> {
    // 1) Si el adjunto trae contentUrl (p. ej. imagen alojada por Teams), descargar por ahí
    if (attachment.contentUrl) {
      const generic = await this.downloadGenericFile(attachment, botToken);
      if (generic) return generic;
    }

    // 2) Buscar imagen en base64 dentro del HTML: <img src="data:image/...;base64,...">
    const dataUriMatch = htmlContent.match(/<img[^>]+src\s*=\s*["'](data:image\/(\w+);base64,([^"']+))["']/i);
    if (dataUriMatch) {
      const mime = `image/${dataUriMatch[2].toLowerCase()}`;
      const base64 = dataUriMatch[3].replace(/\s/g, '');
      try {
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > 0) {
          return {
            buffer,
            contentType: mime,
            name: attachment.name || `imagen.${dataUriMatch[2]}`,
          };
        }
      } catch {
        // base64 inválido, seguir
      }
    }
    // 2b) data:image suelto en el HTML (otro formato que pueda usar Teams)
    const dataUriLoose = htmlContent.match(/data:image\/(\w+);base64,([A-Za-z0-9+/=]+)/);
    if (dataUriLoose) {
      try {
        const buffer = Buffer.from(dataUriLoose[2].replace(/\s/g, ''), 'base64');
        if (buffer.length > 0) {
          const mime = `image/${dataUriLoose[1].toLowerCase()}`;
          return {
            buffer,
            contentType: mime,
            name: attachment.name || `imagen.${dataUriLoose[1]}`,
          };
        }
      } catch {
        // ignorar
      }
    }

    // 3) Buscar <img src="https://..."> (URL de imagen alojada)
    const imgUrlMatch = htmlContent.match(/<img[^>]+src\s*=\s*["'](https?:\/\/[^"']+)["']/i);
    if (imgUrlMatch && imgUrlMatch[1]) {
      try {
        const headers: Record<string, string> = {};
        if (botToken) headers['Authorization'] = `Bearer ${botToken}`;
        const response = await firstValueFrom(
          this.httpService.get(imgUrlMatch[1], { headers, responseType: 'arraybuffer', timeout: 15000 })
        );
        const buffer = Buffer.from(response.data);
        const contentType = (response.headers['content-type'] as string) || 'image/png';
        const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
        return {
          buffer,
          contentType,
          name: attachment.name || `imagen.${ext}`,
        };
      } catch (e: any) {
        this.logger.warn(`No se pudo descargar imagen desde HTML (${imgUrlMatch[1]}): ${e.message}`);
      }
    }

    return null;
  }

  /** Decodifica entidades HTML comunes en una URL (&#58; → :, &#47; → /, etc.). */
  private decodeHtmlEntitiesInUrl(url: string): string {
    return url
      .replace(/&#58;/gi, ':')
      .replace(/&#x3a;/gi, ':')
      .replace(/&#47;/g, '/')
      .replace(/&#x2f;/gi, '/')
      .replace(/%2f/gi, '/')
      .replace(/%3a/gi, ':')
      .trim();
  }

  /**
   * Registra un resumen del payload cuando el adjunto HTML no contiene SharePoint ni imagen.
   * Ayuda a diagnosticar si la imagen llega en channelData u otro adjunto.
   */
  private logPayloadSummaryForDiagnostics(activity: any, currentAttachment: Attachment): void {
    try {
      const summary: string[] = [];
      summary.push(`[DIAG] Total adjuntos: ${activity.attachments?.length ?? 0}`);
      activity.attachments?.forEach((a: Attachment, i: number) => {
        const part = [
          `  [${i}] contentType=${a.contentType}`,
          `name=${a.name ?? 'undefined'}`,
          `contentUrl=${a.contentUrl ? `${a.contentUrl.slice(0, 60)}...` : 'no'}`,
        ].join(', ');
        summary.push(part);
      });
      const cd = activity.channelData;
      if (cd && typeof cd === 'object') {
        summary.push(`[DIAG] channelData keys: ${Object.keys(cd).join(', ')}`);
        if (cd.channel) summary.push(`  channel.id=${(cd.channel as any)?.id}`);
        if (cd.message) summary.push(`  message keys: ${Object.keys((cd.message as any) || {}).join(', ')}`);
      } else {
        summary.push('[DIAG] channelData: vacío o no objeto');
      }
      this.logger.debug(summary.join('\n'));
    } catch (e) {
      this.logger.debug(`[DIAG] Error al generar resumen: ${(e as Error).message}`);
    }
  }
}