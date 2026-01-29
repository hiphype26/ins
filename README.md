# Upwork Job Fetcher

A web application that fetches Upwork job details via their GraphQL API with rate limiting (max 50 requests/hour).

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: Plain HTML/CSS/JavaScript
- **Database**: PostgreSQL (via Prisma ORM)
- **Queue**: Redis + Bull
- **Deployment**: Railway

## Features

- Email/password authentication with JWT
- Upwork OAuth2 integration
- Job URL submission with queue system
- Rate-limited processing (72-120 seconds between requests)
- Dashboard with real-time stats
- Job results with full client details

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis

### Setup

1. Clone the repository:
```bash
git clone https://github.com/hiphype26/HiphypeLMS.git
cd HiphypeLMS
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment file and configure:
```bash
cp .env.example .env
# Edit .env with your values
```

4. Generate Prisma client and push schema:
```bash
npx prisma generate
npx prisma db push
```

5. Start development server:
```bash
npm run dev
```

The app will be available at http://localhost:3001

## Railway Deployment

1. Create a new project on [Railway](https://railway.app)

2. Add plugins:
   - PostgreSQL
   - Redis

3. Connect your GitHub repository

4. Set environment variables:
   - `JWT_SECRET` - Random secret string
   - `UPWORK_CLIENT_ID` - From Upwork Developer Portal
   - `UPWORK_CLIENT_SECRET` - From Upwork Developer Portal
   - `UPWORK_REDIRECT_URI` - `https://your-app.railway.app/api/upwork/callback`
   - `FRONTEND_URL` - `https://your-app.railway.app`

   Note: `DATABASE_URL` and `REDIS_URL` are automatically set by Railway plugins.

5. Deploy! Railway will:
   - Build the TypeScript code
   - Run Prisma migrations
   - Start the server

## Getting Upwork API Credentials

1. Go to [Upwork Developer Portal](https://www.upwork.com/developer/keys/app)
2. Create a new application
3. Set the callback URL to your deployed app URL + `/api/upwork/callback`
4. Copy the Client ID and Client Secret

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Upwork
- `GET /api/upwork/login` - Get OAuth URL
- `GET /api/upwork/callback` - OAuth callback
- `GET /api/upwork/status` - Connection status
- `POST /api/upwork/disconnect` - Disconnect account

### Jobs
- `POST /api/jobs` - Submit job URL
- `GET /api/jobs` - Get all jobs
- `GET /api/jobs/:id` - Get single job
- `GET /api/jobs/stats/queue` - Get queue stats

## Data Fetched Per Job

| Field | Description |
|-------|-------------|
| title | Job title |
| description | Full job description |
| skills | Required skills (comma-separated) |
| posted_date | When job was posted |
| budget | Fixed price or hourly rate |
| proposals_count | Number of proposals submitted |
| client_name | Client/company name |
| client_city | Client's city |
| client_country | Client's country |
| client_spend | Total spent on Upwork |
| client_hires | Total freelancers hired |
| client_reviews | Number of reviews |
| client_rating | Feedback score |
| client_verified | Payment verified status |

## License

MIT
