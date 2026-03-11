import { Version3Client } from 'jira.js';

export interface JiraCredentials {
  host: string;
  email: string;
  apiToken: string;
}

/**
 * Create a configured jira.js Version3Client.
 */
export function createJiraClient(creds: JiraCredentials): Version3Client {
  return new Version3Client({
    host: creds.host,
    authentication: {
      basic: {
        email: creds.email,
        apiToken: creds.apiToken,
      },
    },
  });
}
