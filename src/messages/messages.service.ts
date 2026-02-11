// Servicio para gestionar mensajes individuales
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../common/entities/message.entity';

@Injectable()
export class MessagesService {
  private readonly MAX_MESSAGES_PER_CONVERSATION = 10;

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  /**
   * Guarda un mensaje y mantiene solo los últimos N mensajes por conversación
   */
  async saveMessage(data: {
    conversationId: number;
    content: string;
    source: 'whatsapp' | 'teams';
    teamsMessageId?: string;
    waMessageId?: string;
    senderName?: string;
  }): Promise<Message> {
    // Guardar el nuevo mensaje
    const newMessage = this.messageRepository.create(data);
    const savedMessage = await this.messageRepository.save(newMessage);

    // Mantener solo los últimos N mensajes por conversación
    await this.keepLastMessages(data.conversationId);

    return savedMessage;
  }

  /**
   * Mantiene solo los últimos N mensajes de una conversación
   * Elimina los mensajes más antiguos que excedan el límite
   */
  private async keepLastMessages(conversationId: number): Promise<void> {
    // Obtener todos los mensajes de la conversación ordenados por fecha (más recientes primero)
    const allMessages = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });

    // Si hay más mensajes que el límite, eliminar los más antiguos
    if (allMessages.length > this.MAX_MESSAGES_PER_CONVERSATION) {
      const messagesToDelete = allMessages.slice(
        this.MAX_MESSAGES_PER_CONVERSATION,
      );
      const idsToDelete = messagesToDelete.map((msg) => msg.id);

      if (idsToDelete.length > 0) {
        await this.messageRepository.delete(idsToDelete);
        console.log(
          `🗑️ Eliminados ${idsToDelete.length} mensajes antiguos de la conversación ${conversationId}`,
        );
      }
    }
  }

  /**
   * Obtiene los últimos N mensajes de una conversación
   */
  async getLastMessages(
    conversationId: number,
    limit: number = this.MAX_MESSAGES_PER_CONVERSATION,
  ): Promise<Message[]> {
    return await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Obtiene todos los mensajes de una conversación
   */
  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    return await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Elimina todos los mensajes de una conversación
   */
  async deleteMessagesByConversation(conversationId: number): Promise<void> {
    await this.messageRepository.delete({ conversationId });
  }
}
