import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Listar servidores do usuário logado
router.get('/', authMiddleware, async (req: any, res) => {
  try {
    const userId = req.userId;
    const servers = await prisma.server.findMany({
      where: {
        members: {
          some: { userId }
        }
      }
    });
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar servidores' });
  }
});

// Criar um servidor
router.post('/', authMiddleware, async (req: any, res) => {
  try {
    const { name } = req.body;
    const userId = req.userId;

    const server = await prisma.server.create({
      data: {
        name,
        ownerId: userId,
        members: {
          create: { userId, role: 'ADMIN' }
        },
        channels: {
          create: [
            { name: 'geral', type: 'TEXT' },
            { name: 'Geral', type: 'VOICE' }
          ]
        }
      }
    });
    res.json(server);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar servidor' });
  }
});

// Detalhes do servidor (canais e membros)
router.get('/:serverId', authMiddleware, async (req: any, res) => {
  try {
    const { serverId } = req.params;
    const userId = req.userId;

    // Verifica se o usuário é membro
    const member = await prisma.serverMember.findUnique({
      where: { userId_serverId: { userId, serverId } }
    });

    if (!member) {
      return res.status(403).json({ error: 'Não autorizado' });
    }

    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        channels: true,
        members: { include: { user: { select: { id: true, name: true } } } }
      }
    });

    res.json(server);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar detalhes do servidor' });
  }
});

export default router;
