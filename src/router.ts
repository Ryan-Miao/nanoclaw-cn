import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';

import { Channel, NewMessage } from './types.js';
import { logger } from './logger.js';
import { DATA_DIR } from './config.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map(
    (m) =>
      `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

/**
 * Extract markdown image links from text
 * Returns array of { alt, url, fullMatch }
 */
export function extractMarkdownImages(
  text: string,
): Array<{ alt: string; url: string; fullMatch: string }> {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: Array<{ alt: string; url: string; fullMatch: string }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    images.push({
      alt: match[1],
      url: match[2],
      fullMatch: match[0],
    });
  }
  return images;
}

/**
 * Download an image from URL to a local file
 */
export async function downloadImage(
  url: string,
  destDir: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
    const ext = path.extname(new URL(url).pathname) || '.png';
    const filename = `downloaded-${hash}${ext}`;
    const filepath = path.join(destDir, filename);

    // Skip if already downloaded
    if (fs.existsSync(filepath)) {
      resolve(filepath);
      return;
    }

    fs.mkdirSync(destDir, { recursive: true });
    const file = fs.createWriteStream(filepath);

    const request = client.get(url, { timeout: 30000 }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(filepath);
          downloadImage(redirectUrl, destDir).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    });

    request.on('error', (err) => {
      file.close();
      try {
        fs.unlinkSync(filepath);
      } catch {}
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Process text with markdown images:
 * 1. Download images
 * 2. Send via channel.sendImage
 * 3. Remove markdown links from text
 */
export async function processAndSendImages(
  text: string,
  channel: Channel,
  chatJid: string,
  groupFolder: string,
): Promise<string> {
  if (!channel.sendImage) {
    return text; // Channel doesn't support images
  }

  const images = extractMarkdownImages(text);
  if (images.length === 0) {
    return text;
  }

  const imagesDir = path.join(DATA_DIR, 'groups', groupFolder, 'images');
  let processedText = text;

  for (const img of images) {
    try {
      logger.info({ url: img.url, alt: img.alt }, 'Downloading markdown image');
      const localPath = await downloadImage(img.url, imagesDir);
      logger.info({ localPath }, 'Image downloaded, sending via channel');

      await channel.sendImage(chatJid, localPath);

      // Remove the markdown image link from text
      processedText = processedText.replace(img.fullMatch, '').trim();
    } catch (err) {
      logger.warn({ err, url: img.url }, 'Failed to download/send image');
      // Keep the markdown link in text if download fails
    }
  }

  return processedText;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
