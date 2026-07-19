import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = process.env.PORT || 8787;
const model = process.env.OPENAI_MODEL || "gpt-5.6";

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.post("/recognize", async (request, response) => {
  try {
    const { lineImage } = request.body || {};
    if (!lineImage) {
      response.status(400).json({ error: "lineImage required" });
      return;
    }
    const text = await askForJson([
      { type: "input_text", text: "Read this handwritten math line. Return JSON only: {\"text\":\"...\"}." },
      { type: "input_image", image_url: asDataUrl(lineImage) }
    ]);
    response.json({ text: String(text.text || "") });
  } catch {
    response.status(502).json({ error: "recognize failed" });
  }
});

app.post("/refine", async (request, response) => {
  try {
    const { currentLineImage, priorLines = [] } = request.body || {};
    if (!currentLineImage) {
      response.status(400).json({ error: "currentLineImage required" });
      return;
    }
    const result = await askForJson([
      {
        type: "input_text",
        text: [
          "Given the handwritten current line and prior recognized lines, identify whether the current line references a prior line.",
          "Return JSON only: {\"referencedLineId\":null|string,\"isKeyResult\":false|true}.",
          `Prior lines: ${JSON.stringify(priorLines.slice(0, 24))}`
        ].join("\n")
      },
      { type: "input_image", image_url: asDataUrl(currentLineImage) }
    ]);
    response.json({
      referencedLineId: result.referencedLineId || null,
      isKeyResult: Boolean(result.isKeyResult)
    });
  } catch {
    response.status(502).json({ error: "refine failed" });
  }
});

app.listen(port, () => {
  console.log(`Kairo proxy listening on ${port}`);
});

async function askForJson(content) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }]
    })
  });

  if (!response.ok) {
    throw new Error("OpenAI request failed");
  }

  const data = await response.json();
  const output = data.output_text
    || data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text
    || "{}";
  return JSON.parse(output);
}

function asDataUrl(image) {
  return image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
}
