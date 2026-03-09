import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export type LeadStatus = 'por contactar' | 'contactado' | 'no respuesta';

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombre: string;

  @Column()
  telefono: string; // Importante: Aquí guardaremos el número normalizado

  @Column({ nullable: true })
  origen: string; // Ej: 'facebook_ads', 'instagram_ads'

  @Column({ nullable: true })
  ciudad: string;

  @Column({ 
    type: 'enum', 
    enum: ['por contactar', 'contactado', 'no respuesta'], 
    default: 'por contactar' 
  })
  estado: LeadStatus;

  @Column({ nullable: true, unique: true })
  leadgen_id: string; // ID único de Meta para trazabilidad

  @CreateDateColumn()
  fecha_creacion: Date;
}