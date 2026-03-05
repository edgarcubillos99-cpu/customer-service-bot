// Servicio para gestionar mensajes individuales
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../common/entities/message.entity';

@Injectable()
export class MessagesService {

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  //Guarda un mensaje y verifica duplicados antes de guardar para evitar mensajes duplicados
  async saveMessage(data: {
    conversationId: number;
    content: string;
    source: 'whatsapp' | 'teams';
    teamsMessageId?: string;
    waMessageId?: string;
    senderName?: string;
  }): Promise<Message | null> {
    // Verificar duplicados antes de guardar
    if (data.waMessageId) {
      const exists = await this.messageExistsByWaId(data.waMessageId);
      if (exists) {
        console.log(
          `⏭️ Mensaje de WhatsApp duplicado ignorado: ${data.waMessageId}`,
        );
        return null;
      }
    }

    if (data.teamsMessageId) {
      const exists = await this.messageExistsByTeamsId(data.teamsMessageId);
      if (exists) {
        console.log(
          `⏭️ Mensaje de Teams duplicado ignorado: ${data.teamsMessageId}`,
        );
        return null;
      }
    }

    // Guardar el nuevo mensaje
    // Manejar posibles condiciones de carrera donde dos requests pasan la verificación simultáneamente
    try {
      const newMessage = this.messageRepository.create(data);
      const savedMessage = await this.messageRepository.save(newMessage);
      return savedMessage;
    } catch (error: any) {
      // Si hay un error de violación de índice único (condición de carrera),
      // significa que otro proceso ya guardó este mensaje
      if (
        error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        error?.message?.includes('UNIQUE constraint failed') ||
        error?.message?.includes('duplicate key')
      ) {
        console.log(
          `⏭️ Mensaje duplicado detectado por índice único (condición de carrera): ${data.waMessageId || data.teamsMessageId}`,
        );
        return null;
      }
      // Si es otro tipo de error, relanzarlo
      throw error;
    }
  }

  /**
   * Obtiene los últimos N mensajes de una conversación
   */
  async getLastMessages(
    conversationId: number,
    limit: number = 50
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

  /**
   * Verifica si un mensaje de WhatsApp ya fue procesado
   * Esto previene duplicados cuando WhatsApp envía el mismo mensaje múltiples veces
   */
  async messageExistsByWaId(waMessageId: string): Promise<boolean> {
    if (!waMessageId) {
      return false;
    }
    const count = await this.messageRepository.count({
      where: { waMessageId },
    });
    return count > 0;
  }

  /**
   * Verifica si un mensaje de Teams ya fue procesado
   * Esto previene duplicados cuando Teams envía el mismo mensaje múltiples veces
   */
  async messageExistsByTeamsId(teamsMessageId: string): Promise<boolean> {
    if (!teamsMessageId) {
      return false;
    }
    const count = await this.messageRepository.count({
      where: { teamsMessageId },
    });
    return count > 0;
  }
}
