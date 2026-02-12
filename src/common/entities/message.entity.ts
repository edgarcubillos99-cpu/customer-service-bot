// Entidad para guardar mensajes individuales
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity('messages')
@Index(['waMessageId'], { unique: true })
@Index(['teamsMessageId'], { unique: true })
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  conversationId: number; // ID de la conversación a la que pertenece

  @Column()
  content: string; // Contenido del mensaje

  @Column()
  source: string; // 'whatsapp' o 'teams'

  @Column({ nullable: true })
  teamsMessageId: string; // ID del mensaje en Teams (si viene de Teams)

  @Column({ nullable: true })
  waMessageId: string; // ID del mensaje en WhatsApp (si viene de WhatsApp)

  @Column({ nullable: true })
  senderName: string; // Nombre del remitente

  @CreateDateColumn()
  createdAt: Date;

  // Relación con Conversation
  @ManyToOne(() => Conversation, {
    onDelete: 'CASCADE', // Si se elimina la conversación, se eliminan los mensajes
  })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;
}

