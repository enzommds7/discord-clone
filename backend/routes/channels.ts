import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Buscar mensagens de um canal
router.get('/:channelId/messages', authMiddleware, async (req: any, res) => {
  try {
    const { channelId } = req.params;
    
    // Simplificado: não checa se usuário tem acesso ao servidor do canal,
    // Em prod, faríamos um JOIN para ver se o req.userId está em ServerMember do Server do Channel.
    const messages = await prisma.message.findMany({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, name: true } }
      }
    });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

export default router;
