#!/usr/bin/env node

import { writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MAX_MEMES = 5;
const IMAGE_DIR = "public/images/memes";
const DATA_DIR = "src/data/memes";

async function callLLM(messages, token, temperature = 0.7) {
  const res = await fetch(
    "https://models.github.ai/inference/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
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

async function fetchTemplates() {
  const res = await fetch("https://api.imgflip.com/get_memes");
  if (!res.ok) throw new Error(`Imgflip API error: ${res.status}`);
  const data = await res.json();
  if (!data.success)
    throw new Error(`Imgflip API error: ${data.error_message}`);
  return data.data.memes;
}

async function generateMemeIdeas(templates, token) {
  const templateList = templates.map((t) => ({
    id: t.id,
    name: t.name,
    box_count: t.box_count,
  }));

  const raw = await callLLM(
    [
      {
        role: "system",
        content: `You are a comedy writer for "I Hate Lunges" / "Eu Odeio Afundo", a humor site about hating the lunge exercise.

Your job: pick ${MAX_MEMES} meme templates from the provided list and write HILARIOUS bilingual captions (English + Brazilian Portuguese).

Rules:
- CRITICAL: Only use template IDs and names that appear EXACTLY in the provided list. Do not invent, guess, or modify any ID or name.
- Write texts in the correct spatial order for each box. For well-known templates, follow these conventions:
  - Distracted Boyfriend: box 1 = girlfriend (thing being ignored/abandoned), box 2 = boyfriend (the subject), box 3 = girl in red (the temptation)
  - Drake Hotline Bling: box 1 = thing Drake rejects (top panel), box 2 = thing Drake approves (bottom panel)
  - Two Buttons: box 1 = first button label, box 2 = second button label, box 3 = sweating person label
  - Change My Mind: box 1 = the controversial statement on the table sign
  - Panik Kalm Panik: box 1 = first panic trigger, box 2 = the calming realization, box 3 = the bigger panic
  - For any other template, use common sense based on the template name to match text to the correct visual position.
- Pick templates that work well for lunge/leg day humor.
- Each template has a "box_count" — that's how many text boxes it has. Write exactly that many texts per language.
- The texts are the actual words that appear ON the meme image. Keep them short and punchy — they must fit in small text boxes.
- Also write a short caption (alt text) for each meme in both languages — this is shown below the meme in the gallery, separate from the image text.
- "Afundo" is the Portuguese word for "lunge" (the exercise). CRITICAL: it NEVER pluralizes in Brazilian Portuguese. Writing "afundos" is ALWAYS wrong. Use "afundo" even when referring to multiple lunges (e.g. "sem afundo", "odeio afundo", not "sem afundos").
- Be creative and varied — don't repeat the same joke structure across memes.
- Make sure the humor works in BOTH languages (adapt the joke culturally, don't translate literally).
- Use UPPERCASE for the meme image texts (classic meme style).

Return ONLY a JSON array (no markdown fences, no explanation):
[
  {
    "templateId": "12345",
    "templateName": "Template Name",
    "boxes_en": ["TOP TEXT", "BOTTOM TEXT"],
    "boxes_pt": ["TEXTO DE CIMA", "TEXTO DE BAIXO"],
    "caption_en": "Short funny description",
    "caption_pt": "Descrição curta e engraçada"
  }
]`,
      },
      {
        role: "user",
        content: `Here are the available meme templates:\n\n${JSON.stringify(templateList, null, 2)}`,
      },
    ],
    token,
    1.0,
  );

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse meme ideas JSON: ${raw}`);
  const ideas = JSON.parse(match[0]);

  const validIds = new Set(templates.map((t) => t.id));
  const valid = ideas.filter((idea) => {
    if (!validIds.has(idea.templateId)) {
      console.warn(`Dropping "${idea.templateName}": unknown templateId ${idea.templateId}`);
      return false;
    }
    return true;
  });

  // Fix any "afundos" the LLM snuck in despite instructions
  for (const idea of valid) {
    idea.boxes_pt = idea.boxes_pt.map((t) => t.replace(/afundos/gi, "afundo"));
    idea.caption_pt = idea.caption_pt.replace(/afundos/gi, "afundo");
  }

  return valid;
}

async function captionImage(templateId, texts, username, password) {
  const params = new URLSearchParams({
    template_id: templateId,
    username,
    password,
  });

  texts.forEach((text, i) => {
    params.append(`boxes[${i}][text]`, text);
  });

  const res = await fetch("https://api.imgflip.com/caption_image", {
    method: "POST",
    body: params,
  });

  const data = await res.json();
  if (!data.success)
    throw new Error(`Imgflip caption error: ${data.error_message}`);
  return data.data.url;
}

async function downloadImage(imageUrl, name) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);
  const filename = `${name}-${hash}.jpg`;
  await writeFile(join(IMAGE_DIR, filename), buffer);
  return filename;
}

async function getExistingTemplateIds() {
  const files = await readdir(DATA_DIR).catch(() => []);
  const ids = new Set();

  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith("placeholder")) continue;
    try {
      const content = await import(join(process.cwd(), DATA_DIR, file), {
        with: { type: "json" },
      });
      if (content?.default?.templateId) ids.add(content.default.templateId);
    } catch {
      // skip unreadable files
    }
  }

  return ids;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const imgflipUser = process.env.IMGFLIP_USERNAME;
  const imgflipPass = process.env.IMGFLIP_PASSWORD;

  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }
  if (!imgflipUser || !imgflipPass) {
    console.error("IMGFLIP_USERNAME and IMGFLIP_PASSWORD are required");
    process.exit(1);
  }

  await mkdir(IMAGE_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  const existingIds = await getExistingTemplateIds();
  console.log(`Found ${existingIds.size} existing memes`);

  console.log("Fetching meme templates from Imgflip...");
  const templates = await fetchTemplates();
  console.log(`Got ${templates.length} templates`);

  const available = templates.filter((t) => !existingIds.has(t.id));
  console.log(
    `${available.length} templates available (${existingIds.size} already used)`,
  );

  console.log("Asking LLM to pick templates and write captions...");
  const ideas = await generateMemeIdeas(available, token);
  console.log(`LLM generated ${ideas.length} meme ideas`);

  const results = [];
  for (const idea of ideas) {
    const slug = idea.templateName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "");
    console.log(`\nGenerating: "${idea.templateName}" (${slug})`);

    try {
      console.log("  Creating EN image...");
      const enUrl = await captionImage(
        idea.templateId,
        idea.boxes_en,
        imgflipUser,
        imgflipPass,
      );
      console.log(`  EN: ${enUrl}`);

      console.log("  Creating PT image...");
      const ptUrl = await captionImage(
        idea.templateId,
        idea.boxes_pt,
        imgflipUser,
        imgflipPass,
      );
      console.log(`  PT: ${ptUrl}`);

      const enFilename = await downloadImage(enUrl, `${slug}-en`);
      const ptFilename = await downloadImage(ptUrl, `${slug}-pt`);

      const entry = {
        image: {
          en: `/images/memes/${enFilename}`,
          pt: `/images/memes/${ptFilename}`,
        },
        caption: {
          en: idea.caption_en,
          pt: idea.caption_pt,
        },
        templateId: idea.templateId,
        templateName: idea.templateName,
        date: new Date().toISOString().split("T")[0],
      };

      const entryPath = join(DATA_DIR, `${slug}.json`);
      await writeFile(entryPath, JSON.stringify(entry, null, 2) + "\n");
      results.push(entry);
      console.log(`  ✓ Saved ${slug}.json`);
    } catch (err) {
      console.warn(`  ✗ Failed: ${err.message}`);
    }
  }

  console.log(`\nDone: ${results.length} new memes generated`);

  if (results.length > 0) {
    const summary = results
      .map((r) => `- **${r.templateName}**: ${r.caption.en}`)
      .join("\n");
    await writeFile("/tmp/meme-summary.md", summary + "\n");
  }
}

main();
