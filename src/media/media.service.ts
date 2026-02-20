import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { MediaAttachment } from '../common/entities/media-attachment.entity';

export interface SaveMediaDto {
  waMediaId?: string;
  teamsAttachmentId?: string;
  conversationId?: number;
  mimetype: string;
  fileName?: string;
  data: Buffer;
  source: 'whatsapp' | 'teams';
  caption?: string;
}

export interface MediaResult {
  id: number;
  mimetype: string;
  fileName: string;
  size: number;
  mediaType: string;
  publicUrl: string;
  base64Data?: string; // Base64 del archivo para envío directo
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly whatsappToken: string;
  private readonly whatsappPhoneId: string;
  private readonly publicUrl: string;

  constructor(
    @InjectRepository(MediaAttachment)
    private readonly mediaRepository: Repository<MediaAttachment>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.whatsappToken = this.configService.get<string>('whatsappToken') ?? '';
    this.whatsappPhoneId = this.configService.get<string>('whatsappPhoneId') ?? '';
    this.publicUrl = this.configService.get<string>('PUBLIC_URL') ?? '';
  }

  /**
   * Guarda un archivo multimedia en la base de datos
   */
  async saveMedia(dto: SaveMediaDto): Promise<MediaResult> {
    // Verificar si ya existe por waMediaId para evitar duplicados
    if (dto.waMediaId) {
      const existing = await this.mediaRepository.findOne({
        where: { waMediaId: dto.waMediaId },
      });
      if (existing) {
        this.logger.log(`Media ya existente: ${dto.waMediaId}`);
        return this.toMediaResult(existing);
      }
    }

    const media = this.mediaRepository.create({
      ...dto,
      size: dto.data.length,
    });

    const saved = await this.mediaRepository.save(media);
    this.logger.log(`Media guardado: ID=${saved.id}, tipo=${dto.mimetype}, tamaño=${dto.data.length} bytes`);
    
    return this.toMediaResult(saved);
  }

  /**
   * Obtiene un archivo por su ID
   */
  async getMediaById(id: number): Promise<MediaAttachment> {
    const media = await this.mediaRepository.findOne({ where: { id } });
    if (!media) {
      throw new NotFoundException(`Media con ID ${id} no encontrado`);
    }
    return media;
  }

  /**
   * Descarga un archivo desde WhatsApp usando el mediaId
   */
  async downloadFromWhatsApp(mediaId: string): Promise<Buffer | null> {
    try {
      // Paso 1: Obtener la URL temporal del archivo
      this.logger.log(`Descargando media de WhatsApp: ${mediaId}`);
      
      const metaUrlResponse = await lastValueFrom(
        this.httpService.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${this.whatsappToken}` },
        }),
      );

      const mediaUrl = metaUrlResponse.data.url;
      if (!mediaUrl) {
        throw new Error('Meta no devolvió una URL válida');
      }

      // Paso 2: Descargar el binario usando la URL temporal
      const downloadResponse = await lastValueFrom(
        this.httpService.get(mediaUrl, {
          responseType: 'arraybuffer',
          headers: { Authorization: `Bearer ${this.whatsappToken}` },
        }),
      );

      const buffer = Buffer.from(downloadResponse.data);
      this.logger.log(`Media descargado exitosamente: ${buffer.length} bytes`);
      
      return buffer;
    } catch (error: any) {
      this.logger.error(`Error descargando media ${mediaId} de WhatsApp:`, error.message);
      return null;
    }
  }

  /**
   * Descarga y guarda un archivo de WhatsApp
   */
  async downloadAndSaveFromWhatsApp(
    mediaId: string,
    mimetype: string,
    fileName?: string,
    caption?: string,
    conversationId?: number,
  ): Promise<MediaResult | null> {
    const buffer = await this.downloadFromWhatsApp(mediaId);
    if (!buffer) {
      return null;
    }

    return this.saveMedia({
      waMediaId: mediaId,
      mimetype,
      fileName: fileName || this.generateFileName(mimetype),
      data: buffer,
      source: 'whatsapp',
      caption,
      conversationId,
    });
  }

  /**
   * Genera un nombre de archivo basado en el mimetype
   */
  private generateFileName(mimetype: string): string {
    const timestamp = Date.now();
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/3gpp': '3gp',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/opus': 'opus',
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    };

    const ext = extensions[mimetype] || mimetype.split('/')[1] || 'bin';
    return `archivo_${timestamp}.${ext}`;
  }

  /**
   * Convierte una entidad MediaAttachment a MediaResult
   * Incluye base64 para imágenes (mejor compatibilidad con Teams)
   */
  private toMediaResult(media: MediaAttachment, includeBase64 = true): MediaResult {
    const result: MediaResult = {
      id: media.id,
      mimetype: media.mimetype,
      fileName: media.fileName || 'archivo',
      size: media.size,
      mediaType: media.mediaType,
      publicUrl: `${this.publicUrl}/media/download/${media.id}`,
    };

    // Incluir base64 para imágenes (mejor compatibilidad con Teams)
    // Limitar a 5MB para evitar problemas de memoria
    if (includeBase64 && media.mimetype.startsWith('image/') && media.size < 5 * 1024 * 1024) {
      result.base64Data = media.data.toString('base64');
    }

    return result;
  }

  /**
   * Envía un archivo a WhatsApp
   * @param to Número de teléfono destino
   * @param mediaId ID del media en nuestra BD
   * @param caption Texto opcional
   */
  async sendMediaToWhatsApp(
    to: string,
    mediaId: number,
    caption?: string,
  ): Promise<boolean> {
    try {
      const media = await this.getMediaById(mediaId);
      
      // Primero debemos subir el archivo a WhatsApp
      const waMediaId = await this.uploadToWhatsApp(media.data, media.mimetype);
      if (!waMediaId) {
        throw new Error('No se pudo subir el archivo a WhatsApp');
      }

      // Determinar el tipo de mensaje según el mimetype
      const mediaType = this.getWhatsAppMediaType(media.mimetype);
      
      const url = `https://graph.facebook.com/v18.0/${this.whatsappPhoneId}/messages`;
      const payload: any = {
        messaging_product: 'whatsapp',
        to,
        type: mediaType,
        [mediaType]: {
          id: waMediaId,
        },
      };

      // Agregar caption si es imagen, video o documento
      if (caption && ['image', 'video', 'document'].includes(mediaType)) {
        payload[mediaType].caption = caption;
      }

      // Agregar filename para documentos
      if (mediaType === 'document' && media.fileName) {
        payload[mediaType].filename = media.fileName;
      }

      await lastValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${this.whatsappToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(`Media enviado a WhatsApp: ${to}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error enviando media a WhatsApp:`, error.message);
      return false;
    }
  }

  /**
   * Sube un archivo a WhatsApp y retorna el media_id
   */
  private async uploadToWhatsApp(data: Buffer, mimetype: string): Promise<string | null> {
    try {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      
      formData.append('file', data, {
        contentType: mimetype,
        filename: this.generateFileName(mimetype),
      });
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', mimetype);

      const url = `https://graph.facebook.com/v18.0/${this.whatsappPhoneId}/media`;
      
      const response = await lastValueFrom(
        this.httpService.post(url, formData, {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${this.whatsappToken}`,
          },
        }),
      );

      return response.data.id;
    } catch (error: any) {
      this.logger.error(`Error subiendo media a WhatsApp:`, error.message);
      return null;
    }
  }

  /**
   * Determina el tipo de media para WhatsApp API
   */
  private getWhatsAppMediaType(mimetype: string): string {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype === 'image/webp') return 'sticker';
    return 'document';
  }

  /**
   * Limpia archivos antiguos (más de X días)
   * Útil para mantenimiento de la BD
   */
  async cleanOldMedia(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.mediaRepository
      .createQueryBuilder()
      .delete()
      .from(MediaAttachment)
      .where('createdAt < :cutoffDate', { cutoffDate })
      .execute();

    const deleted = result.affected || 0;
    if (deleted > 0) {
      this.logger.log(`Limpieza: ${deleted} archivos antiguos eliminados`);
    }
    
    return deleted;
  }
}

