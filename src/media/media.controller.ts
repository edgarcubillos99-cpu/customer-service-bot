import {
  Controller,
  Get,
  Param,
  Res,
  ParseIntPipe,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly mediaService: MediaService) {}

  /**
   * Endpoint para descargar/visualizar archivos multimedia
   * GET /media/download/:id
   * 
   * Este endpoint es usado por Teams para obtener los archivos adjuntos
   */
  @Get('download/:id')
  async downloadMedia(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    try {
      const media = await this.mediaService.getMediaById(id);
      
      // Determinar si el navegador debería mostrar o descargar el archivo
      const isViewable = this.isViewableInBrowser(media.mimetype);
      
      // Configurar headers para máxima compatibilidad
      res.setHeader('Content-Type', media.mimetype);
      res.setHeader('Content-Length', media.size);
      
      // Headers CORS para permitir acceso desde Teams
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      
      // Evitar restricciones de seguridad
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      if (isViewable) {
        // Para imágenes, videos, PDFs: mostrar inline
        res.setHeader('Content-Disposition', `inline; filename="${media.fileName || 'archivo'}"`);
      } else {
        // Para otros archivos: forzar descarga
        res.setHeader('Content-Disposition', `attachment; filename="${media.fileName || 'archivo'}"`);
      }

      // Cache por 1 hora (los archivos no cambian)
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      this.logger.log(`Sirviendo media ID=${id}, tipo=${media.mimetype}, tamaño=${media.size}`);
      
      // Enviar el archivo
      res.send(media.data);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error sirviendo media ID=${id}:`, error);
      throw new NotFoundException('Archivo no encontrado');
    }
  }

  /**
   * Endpoint para ver información del archivo sin descargarlo
   * GET /media/info/:id
   */
  @Get('info/:id')
  async getMediaInfo(@Param('id', ParseIntPipe) id: number) {
    const media = await this.mediaService.getMediaById(id);
    
    return {
      id: media.id,
      mimetype: media.mimetype,
      fileName: media.fileName,
      size: media.size,
      mediaType: media.mediaType,
      source: media.source,
      createdAt: media.createdAt,
    };
  }

  /**
   * Determina si el tipo de archivo puede mostrarse en el navegador
   */
  private isViewableInBrowser(mimetype: string): boolean {
    const viewableTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'application/pdf',
      'text/plain',
      'text/html',
    ];
    
    return viewableTypes.includes(mimetype) || 
           mimetype.startsWith('image/') || 
           mimetype.startsWith('video/') ||
           mimetype.startsWith('audio/');
  }
}

