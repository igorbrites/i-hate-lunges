#!/usr/bin/env node

import { writeFile, readdir, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";

const SUBREDDITS = ["GymMemes", "gymmemes", "fitnessmemes", "gym"];
const KEYWORDS = [
  "lunge",
  "lunges",
  "lunging",
  "leg day",
  "split squat",
  "bulgarian",
  "step up",
  "step-up",
];
const MAX_MEMES = 5;
const IMAGE_DIR = "public/images/memes";
const DATA_DIR = "src/data/memes";
const REDDIT_USER_AGENT = "i-hate-lunges-bot/1.0";

async function searchReddit(subreddit) {
  const query = KEYWORDS.join("+OR+");
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${query}&restrict_sr=1&sort=top&t=week&limit=25`;

  const res = await fetch(url, {
    headers: { "User-Agent": REDDIT_USER_AGENT },
  });

  if (!res.ok) {
    console.warn(`Reddit search failed for r/${subreddit}: ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.data?.children || [];
}

function isImagePost(post) {
  const url = post.data.url || "";
  const hint = post.data.post_hint || "";
  if (hint === "image") return true;
  return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url);
}

function getImageUrl(post) {
  const url = post.data.url;
  if (/i\.redd\.it|i\.imgur\.com/.test(url)) return url;
  if (post.data.preview?.images?.[0]?.source?.url) {
    return post.data.preview.images[0].source.url.replace(/&amp;/g, "&");
  }
  return url;
}

async function downloadImage(imageUrl, redditId) {
  const res = await fetch(imageUrl, {
    headers: { "User-Agent": REDDIT_USER_AGENT },
  });

  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  let ext = extname(new URL(imageUrl).pathname).split("?")[0] || ".jpg";
  if (contentType.includes("png")) ext = ".png";
  else if (contentType.includes("gif")) ext = ".gif";
  else if (contentType.includes("webp")) ext = ".webp";

  const buffer = Buffer.from(await res.arrayBuffer());
  const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);
  const filename = `${redditId}-${hash}${ext}`;
  const filepath = join(IMAGE_DIR, filename);

  await writeFile(filepath, buffer);
  return { filename, filepath };
}

async function generateCaptions(title, token) {
  const res = await fetch("https://models.inference.ai.github.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: `You write funny, short captions for anti-lunge memes. The site "I Hate Lunges" / "Eu Odeio Afundo" is a humor site about hating the lunge exercise. Return a JSON object with "en" and "pt" keys. Each caption should be a short, witty one-liner (under 80 chars). "Afundo" is the Portuguese word for "lunge" (the exercise). Do not include markdown formatting, only the raw JSON.`,
        },
        {
          role: "user",
          content: `Reddit post title: "${title}"\n\nWrite a funny bilingual caption for this meme.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content.trim();

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Could not parse caption JSON: ${raw}`);

  return JSON.parse(jsonMatch[0]);
}

async function getExistingRedditIds() {
  const files = await readdir(DATA_DIR).catch(() => []);
  const ids = new Set();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const content = await import(join(process.cwd(), DATA_DIR, file), {
      with: { type: "json" },
    }).catch(() => null);
    if (content?.default?.redditId) ids.add(content.default.redditId);
  }

  return ids;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  await mkdir(IMAGE_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  const existingIds = await getExistingRedditIds();
  console.log(`Found ${existingIds.size} existing memes`);

  const allPosts = [];
  for (const sub of SUBREDDITS) {
    console.log(`Searching r/${sub}...`);
    const posts = await searchReddit(sub);
    allPosts.push(...posts);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const candidates = allPosts
    .filter(isImagePost)
    .filter((p) => !existingIds.has(p.data.id))
    .filter((p) => !p.data.over_18)
    .filter((p) => p.data.score > 10);

  const seen = new Set();
  const unique = candidates.filter((p) => {
    if (seen.has(p.data.id)) return false;
    seen.add(p.data.id);
    return true;
  });

  console.log(`Found ${unique.length} new candidate memes`);
  const selected = unique.slice(0, MAX_MEMES);

  const results = [];
  for (const post of selected) {
    const { id, title, subreddit, author, permalink } = post.data;
    const imageUrl = getImageUrl(post);

    console.log(`Processing: "${title}" from r/${subreddit}`);

    try {
      const { filename } = await downloadImage(imageUrl, id);
      const caption = await generateCaptions(title, token);

      const entry = {
        image: `/images/memes/${filename}`,
        caption,
        source: `https://reddit.com${permalink}`,
        subreddit,
        redditId: id,
        author: `u/${author}`,
        date: new Date().toISOString().split("T")[0],
      };

      const entryPath = join(DATA_DIR, `${id}.json`);
      await writeFile(entryPath, JSON.stringify(entry, null, 2) + "\n");
      results.push(entry);
      console.log(`  ✓ Saved ${filename}`);
    } catch (err) {
      console.warn(`  ✗ Failed: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${results.length} new memes added`);

  if (results.length > 0) {
    const summary = results
      .map((r) => `- ${r.caption.en} (r/${r.subreddit})`)
      .join("\n");
    await writeFile("/tmp/meme-summary.md", summary + "\n");
  }
}

main();
