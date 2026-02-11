// aqui se define el servicio de conversaciones
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../common/entities/conversation.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  // Busca si el cliente ya tiene un hilo abierto en Teams
  async findByPhone(waPhoneNumber: string): Promise<Conversation | null> {
    return await this.conversationRepository.findOne({
      where: { waPhoneNumber, status: 'OPEN' },
      order: { createdAt: 'DESC' },
    });
  }

  async findByThreadId(teamsThreadId: string): Promise<Conversation | null> {
    return await this.conversationRepository.findOne({
      where: { teamsThreadId, status: 'OPEN' },
    });
  }

  // Busca la conversación más reciente abierta
  async findMostRecentOpen(): Promise<Conversation | null> {
    return await this.conversationRepository.findOne({
      where: { status: 'OPEN' },
      order: { updatedAt: 'DESC' },
    });
  }

  // Registra un nuevo hilo cuando llega el primer mensaje
  async create(data: {
    waPhoneNumber: string;
    teamsThreadId: string;
    waCustomerName: string;
  }) {
    const newConversation = this.conversationRepository.create(data);
    return await this.conversationRepository.save(newConversation);
  }

  // Opcional: Cerrar el hilo para permitir que uno nuevo se cree después
  async closeConversation(id: number) {
    await this.conversationRepository.update(id, { status: 'CLOSED' });
  }

  // Actualiza el teamsThreadId de una conversación
  async updateThreadId(id: number, teamsThreadId: string) {
    await this.conversationRepository.update(id, { teamsThreadId });
  }
}
