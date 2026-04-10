#!/usr/bin/env node

import { writeFile, readdir, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";

const MEME_SUBREDDITS = ["GymMemes", "gymmemes", "fitnessmemes", "gymhumor"];
const GENERAL_SUBREDDITS = ["gym", "fitness", "bodybuilding"];
const KEYWORDS_REGEX =
  /\b(lunge|lunges|lunging|leg\s?day|split\s?squat|bulgarian|step[\s-]?up|never\s?skip|quad|glute|knee|leg\s?press|squat)\b/i;
const MAX_MEMES = 5;
const IMAGE_DIR = "public/images/memes";
const DATA_DIR = "src/data/memes";
const REDDIT_USER_AGENT = "i-hate-lunges-bot/1.0";

async function fetchSubreddit(subreddit, mode) {
  const url =
    mode === "browse"
      ? `https://www.reddit.com/r/${subreddit}/top.json?t=month&limit=100`
      : `https://www.reddit.com/r/${subreddit}/search.json?q=lunge+OR+lunges+OR+leg+day&restrict_sr=1&sort=top&t=year&limit=50`;

  const res = await fetch(url, {
    headers: { "User-Agent": REDDIT_USER_AGENT },
  });

  if (!res.ok) {
    console.warn(`Reddit failed for r/${subreddit}: ${res.status}`);
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

async function callLLM(messages, token, temperature = 0.7) {
  const res = await fetch(
    "https://models.inference.ai.github.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature,
        messages,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Models API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function scoreMemeRelevance(title, subreddit, token) {
  const raw = await callLLM(
    [
      {
        role: "system",
        content: `You are a meme quality judge for "I Hate Lunges", a humor site about hating the lunge exercise. Rate how relevant and funny a Reddit post would be for this site.

Highly relevant topics: lunges, leg day pain, skipping leg day, quad/glute soreness, lunge variations (Bulgarian split squat, walking lunges), gym memes about legs.
Somewhat relevant: general leg exercises, squat humor, gym culture memes about lower body.
Not relevant: upper body, diet, progress pics, form checks, non-meme content, bodybuilding competition content.

The post must be an actual MEME (funny image macro, reaction image, or humorous format) — not a selfie, progress photo, video screenshot, or gym photo without humor.

Return ONLY a JSON object: {"score": <1-10>, "reason": "<brief reason>"}`,
      },
      {
        role: "user",
        content: `Subreddit: r/${subreddit}\nTitle: "${title}"`,
      },
    ],
    token,
    0.3,
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { score: 0, reason: "parse error" };
  return JSON.parse(match[0]);
}

async function generateCaptions(title, token) {
  const raw = await callLLM(
    [
      {
        role: "system",
        content: `You write funny, short captions for anti-lunge memes. The site "I Hate Lunges" / "Eu Odeio Afundo" is a humor site about hating the lunge exercise. Return a JSON object with "en" and "pt" keys. Each caption should be a short, witty one-liner (under 80 chars). "Afundo" is the Portuguese word for "lunge" (the exercise). Do not include markdown formatting, only the raw JSON.`,
      },
      {
        role: "user",
        content: `Reddit post title: "${title}"\n\nWrite a funny bilingual caption for this meme.`,
      },
    ],
    token,
    0.8,
  );

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

  // Phase 1: Browse meme-dedicated subs for top posts (high signal)
  const allPosts = [];
  for (const sub of MEME_SUBREDDITS) {
    console.log(`Browsing top posts in r/${sub}...`);
    const posts = await fetchSubreddit(sub, "browse");
    allPosts.push(...posts);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Phase 2: Search general subs with keywords (lower signal, LLM filters)
  for (const sub of GENERAL_SUBREDDITS) {
    console.log(`Searching r/${sub} for lunge/leg day keywords...`);
    const posts = await fetchSubreddit(sub, "search");
    allPosts.push(...posts);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Deduplicate and basic filters
  const seen = new Set();
  const candidates = allPosts
    .filter(isImagePost)
    .filter((p) => !existingIds.has(p.data.id))
    .filter((p) => !p.data.over_18)
    .filter((p) => p.data.score > 10)
    .filter((p) => {
      if (seen.has(p.data.id)) return false;
      seen.add(p.data.id);
      return true;
    })
    .sort((a, b) => b.data.score - a.data.score);

  console.log(`Found ${candidates.length} image candidates after basic filtering`);

  // Phase 3: LLM relevance scoring
  const MIN_RELEVANCE_SCORE = 6;
  const scored = [];

  for (const post of candidates) {
    const { title, subreddit, id } = post.data;
    const isMemeSubreddit = MEME_SUBREDDITS.some(
      (s) => s.toLowerCase() === subreddit.toLowerCase(),
    );

    // Meme subs: only require keyword match (already curated meme content)
    // General subs: always score with LLM
    if (isMemeSubreddit && KEYWORDS_REGEX.test(title)) {
      scored.push({ post, score: 8, reason: "keyword match in meme sub" });
      console.log(`  ✓ [8] r/${subreddit}: "${title}" (keyword match)`);
    } else {
      try {
        const result = await scoreMemeRelevance(title, subreddit, token);
        console.log(
          `  ${result.score >= MIN_RELEVANCE_SCORE ? "✓" : "✗"} [${result.score}] r/${subreddit}: "${title}" — ${result.reason}`,
        );
        if (result.score >= MIN_RELEVANCE_SCORE) {
          scored.push({ post, ...result });
        }
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.warn(`  ⚠ LLM scoring failed for "${title}": ${err.message}`);
      }
    }

    if (scored.length >= MAX_MEMES * 2) break;
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, MAX_MEMES);

  console.log(
    `\n${scored.length} posts passed relevance filter, selecting top ${selected.length}`,
  );

  // Phase 4: Download and caption
  const results = [];
  for (const { post } of selected) {
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
      console.warn(`  ✗ Failed (${imageUrl}): ${err.message}`);
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
