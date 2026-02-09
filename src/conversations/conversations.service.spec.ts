/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationsService } from './conversations.service';
import { Conversation } from '../common/entities/conversation.entity';

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((dto) => dto),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: getRepositoryToken(Conversation), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<ConversationsService>(ConversationsService);
  });

  it('debe identificar una conversación existente', async () => {
    mockRepo.findOne.mockResolvedValue({
      teamsThreadId: '12345',
      waPhoneNumber: '57300...',
    });
    const result = await service.findByPhone('57300...');
    expect(result).not.toBeNull();
    expect(result?.teamsThreadId).toBe('12345');
  });
});
