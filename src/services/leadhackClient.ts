import axios from 'axios';

const LEADHACK_API_URL = 'https://app.leadhack.info:3000/api/admin/addDataV4';
const LEADHACK_BEARER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Njk2OTg0OTEsImV4cCI6MTc2OTc4NDg5MX0.8Hr5B6ILCvJ7AJDk6M4cqV_sB5lPUVzzOpwB9fwF7d4';

interface LeadHackPayload {
  link: string;
  job_heading: string;
  job_description: string;
  first_name: string;
  last_name: string;
  country: string;
  city: string;
  company: string;
  rss_feed: string;
}

/**
 * Send job data to LeadHack API
 */
export async function sendToLeadHack(
  jobUrl: string,
  upworkResult: any,
  volnaData: any
): Promise<{ success: boolean; error?: string }> {
  try {
    // Merge Upwork result with Volna fallback
    const result = upworkResult || {};
    const volna = volnaData || {};
    
    // Build payload with Upwork data, falling back to Volna
    const payload: LeadHackPayload = {
      link: jobUrl,
      job_heading: result.title || volna.title || '',
      job_description: result.description || '',
      first_name: result.client_name || '', // Full name in first_name
      last_name: '', // Empty as requested
      country: result.client_country || volna.client_country || '',
      city: result.client_city || '',
      company: result.client_name || '', // Same as first_name (team/company name)
      rss_feed: '1'
    };
    
    // Skip if no meaningful data
    if (!payload.link || !payload.job_heading) {
      return { success: false, error: 'Missing required fields (link or title)' };
    }
    
    // Call LeadHack API
    const response = await axios.post(LEADHACK_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LEADHACK_BEARER_TOKEN}`
      },
      timeout: 30000
    });
    
    console.log(`LeadHack: Successfully sent job ${jobUrl}`);
    return { success: true };
    
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error(`LeadHack: Failed to send job ${jobUrl}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}
