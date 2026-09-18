import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth';
import serverRoutes from './routes/servers';
import channelRoutes from './routes/channels';

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Permitir de qualquer lugar durante dev
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

io.on('connection', (socket) => {
  console.log('Novo usuário conectado:', socket.id);

  // Entrar em um canal de texto ou voz
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} entrou na sala ${roomId}`);
    
    // Notifica outros na sala que um novo par chegou (para WebRTC)
    socket.to(roomId).emit('user-joined', socket.id);
  });

  // Chat de Texto
  socket.on('send-message', async (data) => {
    const { channelId, content, authorId } = data;
    try {
      const message = await prisma.message.create({
        data: { channelId, content, authorId },
        include: { author: { select: { id: true, name: true } } }
      });
      io.to(channelId).emit('new-message', message);
    } catch (e) {
      console.error('Erro ao salvar mensagem', e);
    }
  });

  // --- WEBRTC SIGNALING ---
  
  socket.on('webrtc-offer', (data) => {
    // Envia oferta para um usuário específico
    io.to(data.to).emit('webrtc-offer', {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on('webrtc-answer', (data) => {
    io.to(data.to).emit('webrtc-answer', {
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    io.to(data.to).emit('webrtc-ice-candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('disconnecting', () => {
    // Avisa as salas que este usuário está saindo
    socket.rooms.forEach((roomId) => {
      if (roomId !== socket.id) {
        socket.to(roomId).emit('user-left', socket.id);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
