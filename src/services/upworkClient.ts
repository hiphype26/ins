import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { refreshUpworkToken } from '../routes/upwork';

const UPWORK_GRAPHQL_URL = 'https://api.upwork.com/graphql';

export interface JobDetails {
  id: string;
  url: string;
  title: string;
  description: string;
  skills: string;
  posted_date: string;
  budget: string;
  proposals_count: number;
  client_name: string;
  client_city: string;
  client_country: string;
  client_spend: string;
  client_hires: number;
  client_reviews: number;
  client_rating: number;
  client_verified: boolean;
}

// Extract job ID from URL
export function extractJobId(url: string): string {
  const match = url.match(/~([a-zA-Z0-9]+)/);
  return match ? `~${match[1]}` : '';
}

// Get valid access token (refresh if needed)
async function getValidToken(prisma: PrismaClient, userId: string): Promise<string | null> {
  const token = await prisma.upworkToken.findUnique({
    where: { userId }
  });
  
  if (!token) return null;
  
  // Check if token is expired or expiring soon (5 min buffer)
  const bufferTime = 5 * 60 * 1000;
  if (new Date(token.expiresAt.getTime() - bufferTime) < new Date()) {
    return await refreshUpworkToken(prisma, userId);
  }
  
  return token.accessToken;
}

// Execute GraphQL query
async function executeGraphQL(accessToken: string, query: string, variables: any): Promise<any> {
  const response = await axios.post(
    UPWORK_GRAPHQL_URL,
    { query, variables },
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

// Fetch job details
export async function fetchJobDetails(
  prisma: PrismaClient,
  userId: string,
  jobUrl: string
): Promise<JobDetails | null> {
  const accessToken = await getValidToken(prisma, userId);
  if (!accessToken) {
    throw new Error('No valid Upwork token');
  }
  
  const jobId = extractJobId(jobUrl);
  if (!jobId) {
    throw new Error('Invalid job URL');
  }
  
  // Convert ciphertext to numeric ID
  const ciphertext = jobId;
  let numericId = null;
  if (ciphertext.startsWith('~02')) {
    numericId = ciphertext.slice(3);
  } else if (ciphertext.startsWith('~')) {
    numericId = ciphertext.slice(1);
  }
  
  // Try direct query first
  const directQuery = `
    query GetJob($id: ID!) {
      marketplaceJobPosting(id: $id) {
        id
        content {
          title
          description
        }
        ownership {
          team {
            id
            name
          }
        }
        clientCompanyPublic {
          country {
            name
          }
          city
        }
      }
    }
  `;
  
  // Try with ciphertext
  let result = await executeGraphQL(accessToken, directQuery, { id: ciphertext });
  
  if (result.data?.marketplaceJobPosting) {
    return parseDirectResponse(jobId, jobUrl, result.data.marketplaceJobPosting);
  }
  
  // Try with numeric ID
  if (numericId) {
    result = await executeGraphQL(accessToken, directQuery, { id: numericId });
    if (result.data?.marketplaceJobPosting) {
      return parseDirectResponse(jobId, jobUrl, result.data.marketplaceJobPosting);
    }
  }
  
  // Try search method
  const searchQuery = `
    query SearchJobs($query: String!) {
      marketplaceJobPostingsSearch(searchExpression: $query, pagination: { first: 10 }) {
        edges {
          node {
            id
            ciphertext
            title
            description
            publishedDateTime
            totalApplicants
            skills {
              prettyName
            }
            client {
              totalSpent {
                displayValue
              }
              totalHires
              totalReviews
              totalFeedback
              verificationStatus
              location {
                city
                country
              }
            }
            job {
              ownership {
                team {
                  name
                }
              }
            }
            amount {
              displayValue
            }
            hourlyBudgetMin {
              rawValue
            }
            hourlyBudgetMax {
              rawValue
            }
          }
        }
      }
    }
  `;
  
  result = await executeGraphQL(accessToken, searchQuery, { query: ciphertext });
  
  if (result.data?.marketplaceJobPostingsSearch?.edges) {
    const edges = result.data.marketplaceJobPostingsSearch.edges;
    // Find matching job
    for (const edge of edges) {
      const node = edge.node;
      if (node.ciphertext === ciphertext || node.id === numericId) {
        return parseSearchResponse(jobId, jobUrl, node);
      }
    }
    // Return first result if no exact match
    if (edges.length > 0) {
      return parseSearchResponse(jobId, jobUrl, edges[0].node);
    }
  }
  
  throw new Error('Job not found');
}

// Parse direct query response
function parseDirectResponse(jobId: string, jobUrl: string, data: any): JobDetails {
  const content = data.content || {};
  const ownership = data.ownership || {};
  const team = ownership.team || {};
  const clientPublic = data.clientCompanyPublic || {};
  const country = clientPublic.country || {};
  
  return {
    id: jobId,
    url: jobUrl,
    title: content.title || '',
    description: content.description || '',
    skills: '',
    posted_date: '',
    budget: 'Not specified',
    proposals_count: 0,
    client_name: team.name || '',
    client_city: clientPublic.city || '',
    client_country: country.name || '',
    client_spend: '$0',
    client_hires: 0,
    client_reviews: 0,
    client_rating: 0,
    client_verified: false
  };
}

// Parse search query response
function parseSearchResponse(jobId: string, jobUrl: string, data: any): JobDetails {
  const client = data.client || {};
  const location = client.location || {};
  const totalSpent = client.totalSpent || {};
  const amount = data.amount || {};
  const hourlyMin = data.hourlyBudgetMin || {};
  const hourlyMax = data.hourlyBudgetMax || {};
  const jobOwnership = data.job?.ownership || {};
  const team = jobOwnership.team || {};
  
  // Calculate budget
  let budget = 'Not specified';
  if (amount.displayValue) {
    budget = amount.displayValue;
  } else if (hourlyMin.rawValue || hourlyMax.rawValue) {
    const min = hourlyMin.rawValue || '';
    const max = hourlyMax.rawValue || '';
    budget = min && max ? `$${min}-$${max}/hr` : `$${max || min}/hr`;
  }
  
  // Parse skills
  const skills = (data.skills || []).map((s: any) => s.prettyName || '').join(', ');
  
  return {
    id: jobId,
    url: jobUrl,
    title: data.title || '',
    description: data.description || '',
    skills,
    posted_date: (data.publishedDateTime || '').slice(0, 10),
    budget,
    proposals_count: data.totalApplicants || 0,
    client_name: team.name || '',
    client_city: location.city || '',
    client_country: location.country || '',
    client_spend: totalSpent.displayValue || '$0',
    client_hires: client.totalHires || 0,
    client_reviews: client.totalReviews || 0,
    client_rating: client.totalFeedback || 0,
    client_verified: client.verificationStatus === 'VERIFIED'
  };
}
