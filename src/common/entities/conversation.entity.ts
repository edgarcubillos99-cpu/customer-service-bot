// aqui se definen las entidades que se van a usar en la base de datos
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  waPhoneNumber: string; // Número del cliente

  @Column({ nullable: true })
  waCustomerName: string; // Nombre del cliente

  @Column()
  teamsThreadId: string; // ID del mensaje original en Teams

  @Column({ default: 'OPEN' })
  status: string; // OPEN o CLOSED

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
