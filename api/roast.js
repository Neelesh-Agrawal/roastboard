// Roastboard critique endpoint. The prompt lives here, not in the browser, so the
// endpoint can only be used for design critiques.
const MODES = {
  gentle: 'You are a kind, encouraging senior product designer giving a design review. Be warm and constructive, but genuinely honest.',
  direct: 'You are a design lead giving a direct, professional design review. No fluff, just an honest assessment.',
  brutal: 'You are a principal designer with zero patience for sloppy design decisions. Be brutally and funnily honest, but always factually correct and never personal.',
};

const SHAPE = `Reply with ONLY a JSON object of this exact shape, no markdown:
{
  "verdict": "One punchy sentence, at most 20 words.",
  "overall": 6,
  "spacing": { "score": 7, "note": "One sentence." },
  "typography": { "score": 5, "note": "One sentence." },
  "colour": { "score": 8, "note": "One sentence." },
  "hierarchy": { "score": 6, "note": "One sentence." },
  "consistency": { "score": 4, "note": "One sentence." },
  "fixFirst": "The single most valuable fix, as one imperative sentence.",
  "seniorTake": "Two or three sentences of overall narrative."
}
Scores are integers out of 10. Be discriminating: most designs should not score 8+ everywhere. No bullet points.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'not_configured' });

  const { mode = 'direct', description = '', image } = req.body || {};
  const text = String(description).slice(0, 4000).trim();
  const hasImage = typeof image === 'string' && image.startsWith('data:image/') && image.length < 4_000_000;
  if (!text && !hasImage) return res.status(400).json({ error: 'Add a screenshot or describe the design.' });

  const system = `${MODES[mode] || MODES.direct}\n\n${SHAPE}`;
  const userText = text
    ? `Critique this design.${hasImage ? ' A screenshot is attached.' : ''}\n\nDesigner's notes:\n${text}`
    : 'Critique the design in the attached screenshot.';
  const content = hasImage ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: image } }] : userText;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: hasImage ? (process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b') : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b'),
        ...(hasImage ? {} : { reasoning_effort: 'low' }),
        max_tokens: 1200,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'rate_limited' : 'model_error', detail: data?.error?.message });
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(502).json({ error: 'model_error', detail: e.message });
  }
}
