import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient;

export function initApiLogger(prisma: PrismaClient) {
  prismaInstance = prisma;
}

/**
 * Log an API call
 */
export async function logApiCall(
  apiType: 'upwork' | 'volna' | 'leadhack',
  success: boolean = true,
  endpoint?: string,
  error?: string
) {
  try {
    await prismaInstance.apiCallLog.create({
      data: {
        apiType,
        endpoint,
        success,
        error: error?.substring(0, 500) // Limit error message length
      }
    });
  } catch (err) {
    console.error('Failed to log API call:', err);
  }
}

/**
 * Get API call stats for a date range
 */
export async function getApiStats(startDate: Date, endDate: Date) {
  const calls = await prismaInstance.apiCallLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lt: endDate
      }
    },
    select: {
      apiType: true,
      success: true,
      createdAt: true
    }
  });

  // Group by API type
  const byType: Record<string, { total: number; success: number; failed: number }> = {};
  
  calls.forEach(call => {
    if (!byType[call.apiType]) {
      byType[call.apiType] = { total: 0, success: 0, failed: 0 };
    }
    byType[call.apiType].total++;
    if (call.success) {
      byType[call.apiType].success++;
    } else {
      byType[call.apiType].failed++;
    }
  });

  return {
    total: calls.length,
    byType
  };
}

/**
 * Get hourly breakdown for peak hours analysis
 */
export async function getHourlyStats(startDate: Date, endDate: Date) {
  const calls = await prismaInstance.apiCallLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lt: endDate
      }
    },
    select: {
      apiType: true,
      createdAt: true
    }
  });

  // Group by hour (0-23)
  const hourly: Record<number, number> = {};
  for (let i = 0; i < 24; i++) {
    hourly[i] = 0;
  }

  calls.forEach(call => {
    const hour = call.createdAt.getUTCHours();
    hourly[hour]++;
  });

  // Find peak hour
  let peakHour = 0;
  let peakCount = 0;
  Object.entries(hourly).forEach(([hour, count]) => {
    if (count > peakCount) {
      peakCount = count;
      peakHour = parseInt(hour);
    }
  });

  return {
    hourly,
    peakHour,
    peakCount
  };
}

/**
 * Get daily breakdown
 */
export async function getDailyStats(days: number = 7) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const calls = await prismaInstance.apiCallLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lt: endDate
      }
    },
    select: {
      apiType: true,
      createdAt: true
    }
  });

  // Group by date
  const daily: Record<string, Record<string, number>> = {};

  calls.forEach(call => {
    const dateKey = call.createdAt.toISOString().split('T')[0];
    if (!daily[dateKey]) {
      daily[dateKey] = { upwork: 0, volna: 0, leadhack: 0, total: 0 };
    }
    daily[dateKey][call.apiType]++;
    daily[dateKey].total++;
  });

  return daily;
}
