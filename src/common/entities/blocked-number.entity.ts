import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('blocked_numbers')
export class BlockedNumber {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true }) // 'unique' evita que bloqueemos el mismo número dos veces por error
  phoneNumber: string;

  @CreateDateColumn()
  blockedAt: Date;
}