import { PrismaClient } from '@prisma/client';
import { refreshUpworkToken } from '../routes/upwork';

let refreshInterval: NodeJS.Timeout | null = null;

// Refresh tokens every 5 minutes to keep them alive
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Refresh tokens that will expire in the next 30 minutes
const EXPIRY_BUFFER_MS = 30 * 60 * 1000; // 30 minutes

export function startTokenRefreshScheduler(prisma: PrismaClient) {
  console.log('Token refresh scheduler started - checking every 5 minutes');
  
  // Run immediately on startup
  refreshExpiringTokens(prisma);
  
  // Then run every 30 minutes
  refreshInterval = setInterval(() => {
    refreshExpiringTokens(prisma);
  }, REFRESH_INTERVAL_MS);
}

export function stopTokenRefreshScheduler() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('Token refresh scheduler stopped');
  }
}

async function refreshExpiringTokens(prisma: PrismaClient) {
  try {
    // Find tokens that will expire within the buffer time
    const expiryThreshold = new Date(Date.now() + EXPIRY_BUFFER_MS);
    
    const expiringTokens = await prisma.upworkToken.findMany({
      where: {
        expiresAt: {
          lt: expiryThreshold
        }
      }
    });
    
    if (expiringTokens.length === 0) {
      return; // No tokens need refreshing
    }
    
    console.log(`Refreshing ${expiringTokens.length} Upwork token(s) to keep them alive...`);
    
    for (const token of expiringTokens) {
      try {
        const newToken = await refreshUpworkToken(prisma, token.userId);
        if (newToken) {
          console.log(`Token refreshed for user ${token.userId}`);
        } else {
          console.log(`Failed to refresh token for user ${token.userId} - may need to reconnect`);
        }
      } catch (error) {
        console.error(`Error refreshing token for user ${token.userId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in token refresh scheduler:', error);
  }
}
