import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth';
import upworkRoutes from './routes/upwork';
import jobRoutes from './routes/jobs';
import settingsRoutes from './routes/settings';
import volnaRoutes from './routes/volna';
import { startScheduler } from './services/scheduler';
import { startVolnaScheduler } from './services/volnaScheduler';
import { startTokenRefreshScheduler } from './services/tokenRefreshScheduler';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// Serve static HTML files
app.use(express.static(path.join(__dirname, '../public')));

// Make prisma available to routes
app.set('prisma', prisma);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/upwork', upworkRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/volna', volnaRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve HTML pages for client-side routing
app.get('*', (req, res) => {
  // If it's an API request that wasn't handled, return 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Otherwise serve index.html for client-side routing
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Recovery: Reset stuck "processing" jobs on startup
async function recoverStuckJobs() {
  try {
    const stuckJobs = await prisma.job.updateMany({
      where: { status: 'processing' },
      data: { status: 'queued' }
    });
    
    if (stuckJobs.count > 0) {
      console.log(`Recovered ${stuckJobs.count} stuck jobs (reset to queued)`);
    }
  } catch (error) {
    console.error('Failed to recover stuck jobs:', error);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Recover any stuck jobs from previous run
  await recoverStuckJobs();
  
  // Start the job scheduler
  startScheduler(prisma);
  console.log('Job scheduler started');
  
  // Start the Volna auto-fetch scheduler
  startVolnaScheduler(prisma);
  
  // Start token refresh scheduler to keep Upwork tokens alive
  startTokenRefreshScheduler(prisma);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
