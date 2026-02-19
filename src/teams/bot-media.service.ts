import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { TurnContext } from 'botbuilder';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class BotMediaService {
  private readonly logger = new Logger(BotMediaService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Descarga un archivo adjunto desde Microsoft Teams.
   * @param turnContext El contexto actual de la conversación.
   * @returns Un Buffer con el contenido del archivo o null si falla.
   */
  async downloadTeamsAttachment(turnContext: TurnContext): Promise<{ buffer: Buffer; contentType: string; name: string } | null> {
    const activity = turnContext.activity;

    // Verificar si hay adjuntos
    if (!activity.attachments || activity.attachments.length === 0) {
      return null;
    }

    // Tomamos el primer adjunto (puedes iterar si envían varios)
    const attachment = activity.attachments[0];
    const url = attachment.contentUrl;

    if (!url) {
      this.logger.warn('El adjunto no tiene una URL de contenido válida.');
      return null;
    }

    try {
      // 1. Obtener el token de autenticación del Connector de Bot Framework
      // Corrección: BotAdapter base no tiene 'createConnectorClient', así que usar TurnContext nativamente.
      // TurnContext proporciona connectorClient si está usando BotFrameworkAdapter
      const connectorClient = (turnContext as any).adapter?.connectorClient 
        || (turnContext as any).adapter?.getOrCreateConnectorClient?.(activity.serviceUrl);

      if (!connectorClient) {
        this.logger.error('No se pudo obtener connectorClient del adaptador.');
        return null;
      }
      const token = connectorClient.credentials && connectorClient.credentials.token;
      if (!token) {
        this.logger.error('No se pudo obtener el token de autenticación.');
        return null;
      }
      // 2. Descargar el archivo usando el token en los headers
      this.logger.log(`Descargando archivo desde Teams: ${attachment.name}`);
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer', // Crucial para manejar binarios (Imágenes/PDFs)
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
      );

      return {
        buffer: Buffer.from(response.data),
        contentType: attachment.contentType,
        name: attachment.name || 'archivo_adjunto',
      };
    } catch (error) {
      this.logger.error(`Error al descargar el adjunto de Teams: ${error.message}`, error.stack);
      return null;
    }
  }
}