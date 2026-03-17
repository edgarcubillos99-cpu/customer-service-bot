/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

export interface WhatsappTemplate {
  name: string;
  language: string;
  bodyText: string;
  headerText?: string;
  variables: string[]; // ej. ['{{1}}', '{{2}}']
}
import { InjectRepository } from '@nestjs/typeorm'; // <-- IMPORTANTE: Faltaba esta importación
import { Repository } from 'typeorm';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, Observable } from 'rxjs';
import { AxiosResponse } from 'axios';
import { WhatsappResponse } from '../common/whatsapp-response.interface';
import { Conversation } from '../common/entities/conversation.entity';
import { BlockedNumber } from '../common/entities/blocked-number.entity';
import { GraphService } from '../teams/graph.service';
import { MediaService } from '../media/media.service';
import { FileSecurityBlockedError } from '../security/file-security-blocked.error';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly token: string;
  private readonly phoneId: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly graphService: GraphService,
    private readonly mediaService: MediaService,
    @InjectRepository(BlockedNumber)
    private readonly blockedRepo: Repository<BlockedNumber>, 
  ) {
    this.token = this.configService.get<string>('whatsappToken') ?? '';
    this.phoneId = this.configService.get<string>('whatsappPhoneId') ?? '';
  }

// Método para validar el horario laboral
private isWithinBusinessHours(): boolean {
  const defaultDays = [1, 2, 3, 4, 5]; // Lunes a Viernes por defecto
  const defaultStart = '08:00';
  const defaultEnd = '18:00';

  // 1. Leemos las variables exactas definidas en configuration.ts
  const daysStr = this.configService.get<string>('BUSINESS_DAYS');
  const start = this.configService.get<string>('BUSINESS_HOURS_START') || defaultStart;
  const end = this.configService.get<string>('BUSINESS_HOURS_END') || defaultEnd;

  // 2. Convertimos el string del .env (ej. "1,2,3,4,5") a un array de números
  const days = daysStr ? daysStr.split(',').map(Number) : defaultDays;

  // Forzamos la zona horaria de Bogotá/Colombia
  const formatter = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const nowStr = formatter.format(new Date());
  const currentHourString = nowStr.split(' ')[0]; // Asegura formato "HH:mm"

  const dateInBogota = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const currentDay = dateInBogota.getDay(); // 0 = Dom, 1 = Lun...

  const isWorkingDay = days.includes(currentDay);
  const isWorkingHour = currentHourString >= start && currentHourString <= end;

  return isWorkingDay && isWorkingHour;
}

  async handleIncomingMessage(
    from: string,
    name: string,
    text: string,
    messageId: string,
    mediaId: string,
    mimetype: string,
    fileName: string,
    caption?: string,
  ) {
    try {
      // --- 1. FILTRO DE NÚMEROS BLOQUEADOS ---
      const isBlocked = await this.blockedRepo.findOne({ where: { phoneNumber: from } });
      if (isBlocked) {
        this.logger.warn(`🛑 Mensaje ignorado. El número ${from} está en la lista de bloqueados.`);
        return; // Detenemos la ejecución aquí, no hacemos nada más.
      }

      // --- 2. FILTRO DE HORARIO LABORAL ---
      if (!this.isWithinBusinessHours()) {
        this.logger.log(`🌙 Mensaje fuera de horario de: ${from}`);
        // Enviamos un mensaje automático al cliente ajustado a su hora
        const outOfOfficeMessage = this.getLocalBusinessHoursMessage(from);
        
        await this.sendMessage(from, outOfOfficeMessage);
        return; // Detenemos la ejecución para que no llegue a Teams.
      }

      // 3. Verificar duplicados en BD antes de procesar
      const messageExists = await this.messagesService.messageExistsByWaId(messageId);
      if (messageExists) {
        this.logger.debug(`⏭️ Mensaje duplicado ignorado (BD): ${messageId}`);
        return;
      }

      // 4. Buscar o crear conversación
      let conversation = await this.conversationsService.findByPhone(from);
      
      // 5. Procesar media si existe
      let mediaResult: { id: number; publicUrl: string; mimetype: string; fileName: string; base64Data?: string } | null = null;
      
      if (mediaId) {
        this.logger.log(`📎 Procesando archivo: ${mimetype} - ${fileName || 'sin nombre'}`);
        
        try {
          const result = await this.mediaService.downloadAndSaveFromWhatsApp(
            mediaId,
            mimetype,
            fileName,
            caption,
            conversation?.id,
          );

          if (result) {
            mediaResult = {
              id: result.id,
              publicUrl: result.publicUrl,
              mimetype: result.mimetype,
              fileName: result.fileName,
              base64Data: result.base64Data, // Incluir base64 para Teams
            };
            this.logger.log(`✅ Archivo guardado: ID=${result.id}, URL=${result.publicUrl}, base64=${result.base64Data ? 'sí' : 'no'}`);
          } else {
            this.logger.warn(`⚠️ No se pudo descargar el archivo de WhatsApp`);
          }
        } catch (err: any) {
          if (err instanceof FileSecurityBlockedError) {
            this.logger.warn(`🚫 Archivo de WhatsApp bloqueado por seguridad: ${err.reason}`);
            // No se envía el archivo a Teams; se puede seguir enviando el texto/caption si hay
          } else {
            throw err;
          }
        }
      }

      // 6. Preparar contenido para Teams
      let teamsContent = `<b>${name}:</b> ${text || caption || ''}`;
      
      // Agregar indicador de tipo de media si aplica
      if (mediaResult && !text && !caption) {
        const mediaTypeLabel = this.getMediaTypeLabel(mimetype);
        teamsContent = `<b>${name}:</b> ${mediaTypeLabel}`;
      }

      // 7. Enviar a Teams
      if (conversation && conversation.teamsThreadId) {
        // Responder a un hilo existente
        await this.graphService.replyToThread(
          conversation.teamsThreadId,
          teamsContent,
          mediaResult?.publicUrl,
          mediaResult?.mimetype,
          mediaResult?.fileName,
          mediaResult?.base64Data,
        );
      } else {
        // Crear nuevo hilo
        const result = await this.graphService.sendMessageToChannel(
          name,
          from,
          text || caption || this.getMediaTypeLabel(mimetype),
          mediaResult?.publicUrl,
          mediaResult?.mimetype,
          mediaResult?.fileName,
          mediaResult?.base64Data,
        );

        // Guardar la nueva conversación
        conversation = (await this.conversationsService.create({
          waPhoneNumber: from,
          waCustomerName: name,
          teamsThreadId: result.id,
        })) as Conversation;
      }

      // 8. Guardar el mensaje en la base de datos
      if (!conversation) {
        throw new Error('No se pudo crear o encontrar la conversación');
      }

      await this.messagesService.saveMessage({
        conversationId: conversation.id,
        content: text || caption || this.getMediaTypeLabel(mimetype),
        source: 'whatsapp',
        waMessageId: messageId,
        senderName: name,
      });

      this.logger.log(`✅ Mensaje procesado: ${messageId}`);
    } catch (error: any) {
      this.logger.error(`❌ Error manejando mensaje de WhatsApp: ${error.message}`);
    }
  }

  /**
   * Obtiene una etiqueta descriptiva para el tipo de media
   */
  private getMediaTypeLabel(mimetype: string): string {
    if (mimetype.startsWith('image/webp')) return '🎨 [Sticker]';
    if (mimetype.startsWith('image/')) return '📷 [Imagen]';
    if (mimetype.startsWith('video/')) return '🎬 [Video]';
    if (mimetype.startsWith('audio/')) return '🎵 [Audio]';
    if (mimetype.includes('pdf')) return '📄 [PDF]';
    if (mimetype.startsWith('application/')) return '📎 [Documento]';
    return '📁 [Archivo]';
  }

  /**
   * Deduce la zona horaria basándose en el prefijo telefónico del número de WhatsApp.
   */
  private getTimezoneFromPhone(phone: string): string {
    // Quitamos cualquier '+' por si acaso
    const cleanPhone = phone.replace('+', '');
    
    if (cleanPhone.startsWith('57')) return 'America/Bogota'; // Colombia
    if (cleanPhone.startsWith('52')) return 'America/Mexico_City'; // México
    if (cleanPhone.startsWith('54')) return 'America/Argentina/Buenos_Aires'; // Argentina
    if (cleanPhone.startsWith('56')) return 'America/Santiago'; // Chile
    if (cleanPhone.startsWith('51')) return 'America/Lima'; // Perú
    if (cleanPhone.startsWith('58')) return 'America/Caracas'; // Venezuela
    if (cleanPhone.startsWith('593')) return 'America/Guayaquil'; // Ecuador
    if (cleanPhone.startsWith('507')) return 'America/Panama'; // Panamá
    if (cleanPhone.startsWith('506')) return 'America/Costa_Rica'; // Costa Rica
    if (cleanPhone.startsWith('34')) return 'Europe/Madrid'; // España
    if (cleanPhone.startsWith('1')) return 'America/New_York'; // US/Canadá (por defecto Eastern)
    
    return 'America/Bogota'; // Fallback por defecto
  }

  /**
   * Construye el mensaje de fuera de horario adaptado a la hora del cliente.
   */
/**
   * Construye el mensaje de fuera de horario adaptado a la hora del cliente.
   */
private getLocalBusinessHoursMessage(phone: string): string {
  const defaultStart = '08:00';
  const defaultEnd = '18:00';
  
  // Leemos las variables directas de la configuración
  const start = this.configService.get<string>('BUSINESS_HOURS_START') || defaultStart;
  const end = this.configService.get<string>('BUSINESS_HOURS_END') || defaultEnd;

  const userTz = this.getTimezoneFromPhone(phone);

  // Función para convertir hora Bogotá a hora Local del usuario
  const formatTimeInTz = (timeStr: string, targetTz: string) => {
    const [hours, minutes] = timeStr.split(':');
    const date = new Date();
    // Colombia no tiene horario de verano y siempre es UTC-5.
    // Sumamos 5 a la hora de inicio para llevarla a UTC antes de formatear a la zona destino.
    date.setUTCHours(parseInt(hours, 10) + 5, parseInt(minutes, 10), 0, 0);
    
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: targetTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  };

  const localStart = formatTimeInTz(start, userTz);
  const localEnd = formatTimeInTz(end, userTz);

  // Si escribe desde Colombia, el mensaje es el estándar
  if (userTz === 'America/Bogota') {
    return `👋 ¡Hola! En este momento nuestra oficina está cerrada. Nuestro horario de atención es de Lunes a Sábado de ${localStart} a ${localEnd}.`;
  }

  // Si escribe desde otro país, aclaramos que es su hora local
  return `👋 ¡Hola! En este momento nuestra oficina está cerrada. Nuestro horario de atención es de Lunes a Sábado de ${localStart} a ${localEnd} (hora de tu país).`;
}

  /**
   * Consulta los message templates aprobados en la cuenta WABA de Meta.
   */
  async getTemplates(): Promise<WhatsappTemplate[]> {
    const wabaId = this.configService.get<string>('whatsappWabaId');
    if (!wabaId) {
      this.logger.warn('WHATSAPP_WABA_ID no está configurado. No se pueden obtener templates.');
      return [];
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${wabaId}/message_templates`;
      const response = await lastValueFrom(
        this.http.get(url, {
          params: {
            status: 'APPROVED',
            fields: 'name,language,status,components',
            access_token: this.token,
          },
        }),
      );

      const rawTemplates: any[] = response.data.data ?? [];
      this.logger.debug(`📋 Templates crudos de Meta: ${JSON.stringify(rawTemplates)}`);

      return rawTemplates.map((t) => {
        const bodyComp = t.components?.find((c: any) => c.type === 'BODY');
        const headerComp = t.components?.find(
          (c: any) => c.type === 'HEADER' && c.format === 'TEXT',
        );
        const bodyText: string = bodyComp?.text ?? '';
        const headerText: string | undefined = headerComp?.text;
        const variables = this.extractTemplateVariables(bodyText);

        return { name: t.name as string, language: t.language as string, bodyText, headerText, variables };
      });
    } catch (error: any) {
      const msg = error.response?.data?.error?.message ?? error.message;
      this.logger.error(`❌ Error consultando templates de Meta: ${msg}`);
      return [];
    }
  }

  /**
   * Extrae los marcadores de variable únicos de un texto de template.
   * Soporta tanto variables posicionales ({{1}}) como nombradas ({{nombre}}).
   */
  private extractTemplateVariables(text: string): string[] {
    const matches = text.match(/\{\{[^}]+\}\}/g);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Envía un message template aprobado a un número de WhatsApp.
   * @param to             Número destino (sin +)
   * @param templateName   Nombre exacto del template en Meta
   * @param languageCode   Código de idioma del template (ej. "es_CO", "en_US")
   * @param bodyVariables  Valores para las variables del cuerpo, en orden
   * @param variableTags   Tags originales del template (ej. ['{{nombre}}', '{{1}}'])
   *                       Se usan para detectar si el template requiere parameter_name.
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    bodyVariables: string[] = [],
    variableTags: string[] = [],
  ): Promise<boolean> {
    try {
      const components: any[] = [];
      if (bodyVariables.length > 0) {
        components.push({
          type: 'body',
          parameters: bodyVariables.map((v, idx) => {
            const tag = variableTags[idx] ?? '';
            const paramKey = tag.replace(/^\{\{|\}\}$/g, '').trim();
            // Si el tag no es puramente numérico (ej. {{nombre}}) → named parameter
            const isNamed = paramKey.length > 0 && !/^\d+$/.test(paramKey);
            const param: any = { type: 'text', text: v };
            if (isNamed) param.parameter_name = paramKey;
            return param;
          }),
        });
      }

      const payload: any = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components.length > 0 && { components }),
        },
      };

      const url = `https://graph.facebook.com/v19.0/${this.phoneId}/messages`;

      this.logger.debug(`📦 Payload enviado a Meta: ${JSON.stringify(payload)}`);

      const response = await lastValueFrom(
        this.http.post(url, payload, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `✅ Template '${templateName}' enviado a ${to}. ID: ${response.data.messages[0].id}`,
      );
      return true;
    } catch (error: any) {
      const fullError = error.response?.data ?? error.message;
      this.logger.error(`❌ Error enviando template a ${to}: ${JSON.stringify(fullError)}`);
      const errorMsg = error.response?.data?.error?.message ?? error.message;
      throw new Error(`Fallo al enviar template de Meta: ${errorMsg}`);
    }
  }

  /**
   * Envía un mensaje de texto a WhatsApp
   */
  async sendMessage(to: string, message: string): Promise<WhatsappResponse> {
    if (!this.token || !this.phoneId) {
      throw new InternalServerErrorException('WhatsApp API credentials are missing.');
    }

    const url = `https://graph.facebook.com/v18.0/${this.phoneId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      text: { body: message },
    };

    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    try {
      const observable: Observable<AxiosResponse<WhatsappResponse>> =
        this.http.post(url, payload, { headers });

      const response: AxiosResponse<WhatsappResponse> = await lastValueFrom(observable);

      this.logger.log(`✅ Mensaje enviado a WhatsApp: ${to}`);
      return response.data satisfies WhatsappResponse;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: unknown })?.response === 'object'
      ) {
        const axiosError = err as { response?: { data?: unknown }; message?: string };
        this.logger.error('Error enviando WhatsApp:', axiosError.response?.data ?? axiosError.message ?? err);
      } else {
        this.logger.error('Error desconocido enviando WhatsApp:', err);
      }

      throw new InternalServerErrorException('No se pudo enviar el mensaje.');
    }
  }

  /**
   * Envía un archivo multimedia a WhatsApp
   */
  async sendMediaMessage(
    to: string,
    mediaId: number,
    caption?: string,
  ): Promise<boolean> {
    try {
      return await this.mediaService.sendMediaToWhatsApp(to, mediaId, caption);
    } catch (error: any) {
      this.logger.error(`Error enviando media a WhatsApp: ${error.message}`);
      return false;
    }
  }

  /**
   * Envía un mensaje a WhatsApp buscando la conversación por threadId de Teams
   */
  async sendMessageToWhatsappByThreadId(threadId: string, text: string): Promise<void> {
    const conversation = await this.conversationsService.findByThreadId(threadId);
    if (conversation) {
      await this.sendMessage(conversation.waPhoneNumber, text);
    } else {
      this.logger.error(`No se encontró conversación para el hilo: ${threadId}`);
    }
  }

  /**
   * Envía un archivo a WhatsApp buscando la conversación por threadId de Teams
   */
  async sendMediaToWhatsappByThreadId(
    threadId: string,
    mediaId: number,
    caption?: string,
  ): Promise<void> {
    const conversation = await this.conversationsService.findByThreadId(threadId);
    if (conversation) {
      await this.mediaService.sendMediaToWhatsApp(conversation.waPhoneNumber, mediaId, caption);
    } else {
      this.logger.error(`No se encontró conversación para el hilo: ${threadId}`);
    }
  }
}