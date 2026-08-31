import { Router, json, raw } from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { broadcastContext } from './db.js';
import { broadcast } from './ws.js';

const router = Router();

// ─── Webhook Signature Verification ──────────────────────────

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256).
 * Uses HMAC SHA-256 with the configured webhook secret.
 */
function verifyGitHubSignature(
  payload: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Verify Linear webhook signature.
 * Linear sends an HMAC SHA-256 signature in the Linear-Signature header.
 */
function verifyLinearSignature(
  payload: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── GitHub Webhook ──────────────────────────────────────────

router.post(
  '/api/webhooks/github',
  raw({ type: 'application/json' }),
  (req: Request, res: Response) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('[webhooks] GITHUB_WEBHOOK_SECRET not configured, rejecting webhook');
      res.status(500).json({ error: 'Webhook secret not configured' });
      return;
    }

    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!verifyGitHubSignature(rawBody, signature, secret)) {
      console.warn('[webhooks] GitHub signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    try {
      const event = req.headers['x-github-event'] as string;
      const payload = JSON.parse(rawBody.toString('utf-8'));

      console.log(`[webhooks] GitHub event: ${event}`);

      switch (event) {
        case 'issues': {
          if (payload.action === 'assigned' || payload.action === 'labeled') {
            broadcast('broadcast', {
              agentId: 'github-webhook',
              decisionNotes: `GitHub issue #${payload.issue?.number} "${payload.issue?.title}" was ${payload.action}`,
              provider: 'github',
            });
          }
          break;
        }

        case 'pull_request': {
          if (payload.action === 'opened' || payload.action === 'synchronize') {
            broadcast('broadcast', {
              agentId: 'github-webhook',
              decisionNotes: `PR #${payload.pull_request?.number} "${payload.pull_request?.title}" was ${payload.action} by ${payload.sender?.login}`,
              provider: 'github',
            });
          }
          break;
        }

        case 'push': {
          const branch = payload.ref?.replace('refs/heads/', '');
          const commits = payload.commits?.length || 0;
          broadcast('broadcast', {
            agentId: 'github-webhook',
            decisionNotes: `${commits} commit(s) pushed to ${branch} by ${payload.pusher?.name}`,
            provider: 'github',
          });
          break;
        }

        default:
          console.log(`[webhooks] Unhandled GitHub event: ${event}`);
      }

      res.status(200).json({ received: true, event });
    } catch (err) {
      console.error('[webhooks] Error processing GitHub webhook:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Linear Webhook ──────────────────────────────────────────

router.post(
  '/api/webhooks/linear',
  raw({ type: 'application/json' }),
  (req: Request, res: Response) => {
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('[webhooks] LINEAR_WEBHOOK_SECRET not configured, rejecting webhook');
      res.status(500).json({ error: 'Webhook secret not configured' });
      return;
    }

    const signature = req.headers['linear-signature'] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!verifyLinearSignature(rawBody, signature, secret)) {
      console.warn('[webhooks] Linear signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    try {
      const payload = JSON.parse(rawBody.toString('utf-8'));
      const action = payload.action;
      const type = payload.type;

      console.log(`[webhooks] Linear event: ${type} ${action}`);

      if (type === 'Issue') {
        if (action === 'update' && payload.data?.state?.name === 'In Progress') {
          // Issue moved to "In Progress" — broadcast context
          broadcast('broadcast', {
            agentId: 'linear-webhook',
            decisionNotes: `Linear issue "${payload.data?.title}" (${payload.data?.identifier}) moved to In Progress`,
            provider: 'linear',
          });
        }

        if (action === 'update' && payload.data?.state?.name === 'Done') {
          broadcast('broadcast', {
            agentId: 'linear-webhook',
            decisionNotes: `Linear issue "${payload.data?.title}" (${payload.data?.identifier}) completed`,
            provider: 'linear',
          });
        }
      }

      res.status(200).json({ received: true, type, action });
    } catch (err) {
      console.error('[webhooks] Error processing Linear webhook:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Post Completion Comment (Phase 3) ────────────────────────
/**
 * Post a summary comment back to GitHub PR/issue or Linear issue upon task completion.
 */
export async function postCompletionComment(
  issueId: string,
  summary: string
): Promise<{ success: boolean; message: string }> {
  // 1. Check for GitHub issue / PR
  const ghToken = process.env.GITHUB_TOKEN;
  const ghRepo = process.env.GITHUB_REPO; // e.g. "owner/repo"

  if (ghToken && ghRepo && (/^\d+$/.test(issueId) || issueId.startsWith('#'))) {
    const cleanId = issueId.replace(/^#/, '');
    try {
      const res = await fetch(`https://api.github.com/repos/${ghRepo}/issues/${cleanId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'BranchLock-MCP',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: `### 🔒 BranchLock Task Completion\n\n${summary}` }),
      });

      if (res.ok) {
        console.log(`[webhooks] Posted completion comment to GitHub issue #${cleanId}`);
        return { success: true, message: `Comment posted to GitHub issue #${cleanId}` };
      } else {
        const errText = await res.text();
        console.warn(`[webhooks] Failed to post to GitHub: ${res.status} ${errText}`);
        return { success: false, message: `GitHub API error: ${res.status}` };
      }
    } catch (err) {
      console.error('[webhooks] GitHub comment request failed:', err);
      return { success: false, message: `GitHub request failed: ${err}` };
    }
  }

  // 2. Check for Linear issue
  const linearKey = process.env.LINEAR_API_KEY;
  if (linearKey && (issueId.includes('-') || issueId.length > 10)) {
    try {
      const query = `
        mutation CreateComment($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
            comment { id }
          }
        }
      `;
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: linearKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            issueId,
            body: `### 🔒 BranchLock Task Completion\n\n${summary}`,
          },
        }),
      });

      if (res.ok) {
        console.log(`[webhooks] Posted completion comment to Linear issue ${issueId}`);
        return { success: true, message: `Comment posted to Linear issue ${issueId}` };
      } else {
        const errText = await res.text();
        console.warn(`[webhooks] Linear API error: ${res.status} ${errText}`);
        return { success: false, message: `Linear API error: ${res.status}` };
      }
    } catch (err) {
      console.error('[webhooks] Linear comment request failed:', err);
      return { success: false, message: `Linear request failed: ${err}` };
    }
  }

  // Fallback: Dry-run / local logging when no external tokens are set
  console.log(`[webhooks] Completion comment logged for issue ${issueId} (dry-run, no API tokens configured): ${summary.slice(0, 80)}...`);
  return {
    success: true,
    message: `Dry-run: comment logged locally for ${issueId} (set GITHUB_TOKEN or LINEAR_API_KEY for live posting)`,
  };
}

export default router;
