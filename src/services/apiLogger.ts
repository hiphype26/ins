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
  error?: string,
  filterId?: string
) {
  try {
    await prismaInstance.apiCallLog.create({
      data: {
        apiType,
        endpoint,
        success,
        error: error?.substring(0, 500), // Limit error message length
        filterId: filterId || null
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
 * Get hourly breakdown for peak hours analysis - by API type
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

  // Group by hour (0-23) for each API type
  const hourlyByType: Record<string, Record<number, number>> = {
    upwork: {},
    volna: {},
    leadhack: {},
    total: {}
  };
  
  // Initialize all hours to 0
  ['upwork', 'volna', 'leadhack', 'total'].forEach(type => {
    for (let i = 0; i < 24; i++) {
      hourlyByType[type][i] = 0;
    }
  });

  calls.forEach(call => {
    const hour = call.createdAt.getUTCHours();
    hourlyByType[call.apiType][hour]++;
    hourlyByType.total[hour]++;
  });

  // Find peak hour for each API type
  const findPeak = (hourly: Record<number, number>) => {
    let peakHour = -1;
    let peakCount = 0;
    Object.entries(hourly).forEach(([hour, count]) => {
      if (count > peakCount) {
        peakCount = count;
        peakHour = parseInt(hour);
      }
    });
    return { peakHour, peakCount };
  };

  return {
    hourlyByType,
    peaks: {
      upwork: findPeak(hourlyByType.upwork),
      volna: findPeak(hourlyByType.volna),
      leadhack: findPeak(hourlyByType.leadhack),
      total: findPeak(hourlyByType.total)
    }
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

/**
 * Get detailed API activity - by date, hour, and filter (for Volna)
 */
export async function getDetailedApiActivity(startDate: Date, endDate: Date) {
  const calls = await prismaInstance.apiCallLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lt: endDate
      }
    },
    select: {
      apiType: true,
      filterId: true,
      success: true,
      createdAt: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  // Group by date and hour for Upwork
  const upworkByDateHour: Record<string, Record<number, { total: number; success: number; failed: number }>> = {};
  
  // Group by date and hour for Volna (also by filter)
  const volnaByDateHour: Record<string, Record<number, { total: number; success: number; failed: number }>> = {};
  const volnaByFilter: Record<string, { total: number; success: number; failed: number }> = {};
  
  // Group by date and hour for LeadHack
  const leadhackByDateHour: Record<string, Record<number, { total: number; success: number; failed: number }>> = {};

  calls.forEach(call => {
    const dateKey = call.createdAt.toISOString().split('T')[0];
    const hour = call.createdAt.getUTCHours();
    
    if (call.apiType === 'upwork') {
      if (!upworkByDateHour[dateKey]) {
        upworkByDateHour[dateKey] = {};
      }
      if (!upworkByDateHour[dateKey][hour]) {
        upworkByDateHour[dateKey][hour] = { total: 0, success: 0, failed: 0 };
      }
      upworkByDateHour[dateKey][hour].total++;
      if (call.success) {
        upworkByDateHour[dateKey][hour].success++;
      } else {
        upworkByDateHour[dateKey][hour].failed++;
      }
    }
    
    if (call.apiType === 'volna') {
      if (!volnaByDateHour[dateKey]) {
        volnaByDateHour[dateKey] = {};
      }
      if (!volnaByDateHour[dateKey][hour]) {
        volnaByDateHour[dateKey][hour] = { total: 0, success: 0, failed: 0 };
      }
      volnaByDateHour[dateKey][hour].total++;
      if (call.success) {
        volnaByDateHour[dateKey][hour].success++;
      } else {
        volnaByDateHour[dateKey][hour].failed++;
      }
      
      // Track by filter
      if (call.filterId) {
        if (!volnaByFilter[call.filterId]) {
          volnaByFilter[call.filterId] = { total: 0, success: 0, failed: 0 };
        }
        volnaByFilter[call.filterId].total++;
        if (call.success) {
          volnaByFilter[call.filterId].success++;
        } else {
          volnaByFilter[call.filterId].failed++;
        }
      }
    }
    
    if (call.apiType === 'leadhack') {
      if (!leadhackByDateHour[dateKey]) {
        leadhackByDateHour[dateKey] = {};
      }
      if (!leadhackByDateHour[dateKey][hour]) {
        leadhackByDateHour[dateKey][hour] = { total: 0, success: 0, failed: 0 };
      }
      leadhackByDateHour[dateKey][hour].total++;
      if (call.success) {
        leadhackByDateHour[dateKey][hour].success++;
      } else {
        leadhackByDateHour[dateKey][hour].failed++;
      }
    }
  });

  return {
    upwork: upworkByDateHour,
    volna: volnaByDateHour,
    volnaByFilter,
    leadhack: leadhackByDateHour,
    totalCalls: calls.length
  };
}
