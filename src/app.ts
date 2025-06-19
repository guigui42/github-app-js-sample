import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import { Octokit, App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';

// Load environment variables from .env file
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['APP_ID', 'PRIVATE_KEY_PATH', 'WEBHOOK_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please create a .env file based on .env.sample or .env.example');
  process.exit(1);
}

// Set configured values with proper type assertions
const appId: string = process.env.APP_ID!;
const privateKeyPath: string = process.env.PRIVATE_KEY_PATH!;
const secret: string = process.env.WEBHOOK_SECRET!;
const enterpriseHostname: string | undefined = process.env.ENTERPRISE_HOSTNAME;

// Validate private key file exists
let privateKey: string;
try {
  privateKey = fs.readFileSync(privateKeyPath, 'utf8');
} catch (error) {
  console.error(`Error reading private key file at ${privateKeyPath}:`, error);
  console.error('Please ensure the PRIVATE_KEY_PATH environment variable points to a valid private key file');
  process.exit(1);
}

// Validate message file exists
let messageForNewPRs: string;
try {
  messageForNewPRs = fs.readFileSync('./message.md', 'utf8');
} catch (error) {
  console.error('Error reading message.md file:', error);
  console.error('Please ensure message.md exists in the project root');
  process.exit(1);
}

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  },
  ...(enterpriseHostname && {
    Octokit: Octokit.defaults({
      baseUrl: `https://${enterpriseHostname}/api/v3`
    })
  })
});

// Optional: Get & log the authenticated app's name
const { data } = await app.octokit.request('/app');

// Read more about custom logging: https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`);

// Subscribe to the "pull_request.opened" webhook event
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
  console.log(`Received a pull request event for #${payload.pull_request.number}`);
  try {
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: messageForNewPRs
    });
    console.log(`Successfully commented on PR #${payload.pull_request.number}`);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const apiError = error as { response: { status: number; data: { message: string } } };
      console.error(`Error! Status: ${apiError.response.status}. Message: ${apiError.response.data.message}`);
    } else {
      console.error('Unexpected error:', error);
    }
  }
});

// Optional: Handle errors
app.webhooks.onError((error: Error) => {
  if (error.name === 'AggregateError') {
    // Log Secret verification errors
    const aggregateError = error as Error & { event?: string };
    console.log(`Error processing request: ${aggregateError.event || 'unknown event'}`);
  } else {
    console.log('Webhook error:', error);
  }
});

// Launch a web server to listen for GitHub webhooks
const port: number = parseInt(process.env.PORT || '3000', 10);
const path: string = '/api/webhook';
const localWebhookUrl: string = `http://localhost:${port}${path}`;

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const middleware = createNodeMiddleware(app.webhooks, { path });

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log('Press Ctrl + C to quit.');
});
