import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Entidad para almacenar archivos multimedia (imágenes, videos, audios, documentos)
 * Los archivos se guardan como BLOB en la base de datos
 */
@Entity('media_attachments')
export class MediaAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ nullable: true })
  waMediaId: string; // ID del media en WhatsApp (para evitar duplicados)

  @Index()
  @Column({ nullable: true })
  teamsAttachmentId: string; // ID del attachment en Teams

  @Column({ nullable: true })
  conversationId: number; // Conversación asociada

  @Column()
  mimetype: string; // Tipo MIME (image/jpeg, application/pdf, video/mp4, etc.)

  @Column({ nullable: true })
  fileName: string; // Nombre del archivo

  @Column({ type: 'blob' })
  data: Buffer; // Contenido binario del archivo

  @Column({ default: 0 })
  size: number; // Tamaño en bytes

  @Column()
  source: string; // 'whatsapp' o 'teams'

  @Column({ nullable: true })
  caption: string; // Texto asociado al archivo

  @CreateDateColumn()
  createdAt: Date;

  /**
   * Helper para obtener el tipo de media basado en el mimetype
   */
  get mediaType(): 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'unknown' {
    if (this.mimetype.startsWith('image/webp')) return 'sticker';
    if (this.mimetype.startsWith('image/')) return 'image';
    if (this.mimetype.startsWith('video/')) return 'video';
    if (this.mimetype.startsWith('audio/')) return 'audio';
    if (
      this.mimetype.startsWith('application/') ||
      this.mimetype.startsWith('text/')
    ) {
      return 'document';
    }
    return 'unknown';
  }
}

