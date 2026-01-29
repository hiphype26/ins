import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// Get Upwork config from database settings
async function getUpworkConfig(prisma: PrismaClient) {
  const settings = await prisma.settings.findMany({
    where: {
      key: {
        in: ['upwork_client_id', 'upwork_client_secret', 'upwork_redirect_uri']
      }
    }
  });
  
  const settingsMap: Record<string, string> = {};
  settings.forEach(s => { settingsMap[s.key] = s.value; });
  
  return {
    CLIENT_ID: settingsMap['upwork_client_id'] || '',
    CLIENT_SECRET: settingsMap['upwork_client_secret'] || '',
    REDIRECT_URI: settingsMap['upwork_redirect_uri'] || '',
    AUTH_URL: 'https://www.upwork.com/ab/account-security/oauth2/authorize',
    TOKEN_URL: 'https://www.upwork.com/api/v3/oauth2/token'
  };
}

// Get OAuth URL
router.get('/login', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const config = await getUpworkConfig(prisma);
  
  if (!config.CLIENT_ID || !config.CLIENT_SECRET || !config.REDIRECT_URI) {
    return res.status(400).json({ error: 'Upwork API credentials not configured. Please set them in Settings.' });
  }
  
  const state = req.userId; // Use userId as state for callback
  const authUrl = `${config.AUTH_URL}?response_type=code&client_id=${config.CLIENT_ID}&redirect_uri=${encodeURIComponent(config.REDIRECT_URI)}&state=${state}`;
  res.json({ authUrl });
});

// OAuth callback
router.get('/callback', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const config = await getUpworkConfig(prisma);
  const { code, state, error } = req.query;
  
  const frontendUrl = process.env.FRONTEND_URL || '';
  
  if (error) {
    return res.redirect(`${frontendUrl}/upwork.html?error=${error}`);
  }
  
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/upwork.html?error=missing_params`);
  }
  
  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(config.TOKEN_URL, 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        client_id: config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        redirect_uri: config.REDIRECT_URI
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);
    
    // Save tokens
    await prisma.upworkToken.upsert({
      where: { userId: state as string },
      update: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt
      },
      create: {
        userId: state as string,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt
      }
    });
    
    res.redirect(`${frontendUrl}/upwork.html?success=true`);
  } catch (error: any) {
    console.error('Upwork OAuth error:', error.response?.data || error.message);
    res.redirect(`${frontendUrl}/upwork.html?error=token_failed`);
  }
});

// Get connection status
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const token = await prisma.upworkToken.findUnique({
      where: { userId: req.userId }
    });
    
    if (!token) {
      return res.json({ connected: false });
    }
    
    const isExpired = new Date() > token.expiresAt;
    
    res.json({
      connected: !isExpired,
      expiresAt: token.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Disconnect
router.post('/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    await prisma.upworkToken.delete({
      where: { userId: req.userId }
    });
    res.json({ success: true });
  } catch (error) {
    res.json({ success: true }); // Already disconnected
  }
});

// Refresh token (internal use)
export async function refreshUpworkToken(prisma: PrismaClient, userId: string): Promise<string | null> {
  const config = await getUpworkConfig(prisma);
  
  try {
    const token = await prisma.upworkToken.findUnique({
      where: { userId }
    });
    
    if (!token) return null;
    
    const response = await axios.post(config.TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);
    
    await prisma.upworkToken.update({
      where: { userId },
      data: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt
      }
    });
    
    return access_token;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return null;
  }
}

export default router;
