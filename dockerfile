# --- Etapa 1: Construcción (Builder) ---
    FROM node:20-alpine AS builder

    WORKDIR /app
    
    # Copiamos los archivos de dependencias
    COPY package*.json ./
    
    # Instalamos TODAS las dependencias (incluyendo devDependencies para poder compilar)
    RUN npm ci
    
    # Copiamos el resto del código fuente
    COPY . .
    
    # Compilamos la aplicación NestJS
    RUN npm run build
    
    # --- Etapa 2: Producción ---
    FROM node:20-alpine AS production
    
    WORKDIR /app
    
    # Establecemos el entorno en producción
    ENV NODE_ENV=production
    
    # Copiamos solo los archivos de dependencias
    COPY package*.json ./
    
    # Instalamos SOLO las dependencias de producción (más ligero y seguro)
    RUN npm ci --omit=dev
    
    # Copiamos la carpeta dist (compilada) desde la etapa builder
    COPY --from=builder /app/dist ./dist
    
    # Exponemos el puerto que usa la aplicación
    EXPOSE 3000
    
    # Comando para iniciar la aplicación
    CMD ["npm", "run", "start:prod"]