# Feedback Intelligence Dashboard

An AI-powered customer feedback aggregation and analysis tool built entirely on the Cloudflare Developer Platform.

## Live Demo
https://feedback-intelligence.keerthi-feedback.workers.dev

## Architecture

This project uses **3 Cloudflare Developer Platform products**:

- **Cloudflare Workers**: Serverless compute platform hosting the API and frontend
- **D1 Database**: SQLite-compatible SQL database for storing feedback entries  
- **Workers AI**: Llama 3.1-8B model for automatic sentiment analysis and categorization

## Features

-  Real-time feedback submission from multiple sources (Discord, GitHub, Twitter, Support Email)
-  AI-powered sentiment analysis (positive/negative/neutral)
-  Automatic categorization (Bug, Feature Request, Praise, Complaint)
-  Urgency scoring (1-5 scale)
-  Responsive dashboard with summary metrics
-  Professional UI with Tailwind CSS

## Technologies

- TypeScript
- Cloudflare Workers
- Cloudflare D1 (SQLite)
- Cloudflare Workers AI (Llama 3.1-8B-Instruct)
- Tailwind CSS

## Local Setup
```bash
# Install dependencies
npm install

# Create D1 database
npx wrangler d1 create feedback-db

# Run migrations
npx wrangler d1 execute feedback-db --local --file=schema.sql
npx wrangler d1 execute feedback-db --remote --file=schema.sql

# Start development server
npm run dev
```

## Deployment
```bash
npx wrangler deploy
```

## Product Feedback Flow

1. User submits feedback through the form
2. Workers AI analyzes the text and determines:
   - Sentiment (positive/negative/neutral)
   - Category (Bug/Feature/Praise/Complaint)
   - Urgency level (1-5)
3. Results stored in D1 database
4. Dashboard updates in real-time

## Built For

Cloudflare Product Manager Intern Assignment (Summer 2026)
