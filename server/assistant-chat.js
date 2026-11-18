export async function assistantChat(req, res) {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question || question.length > 1200) {
    return res.status(400).json({ error: "প্রশ্নটি ১২০০ অক্ষরের মধ্যে লিখুন।" });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: "সার্ভারের .env ফাইলে OPENAI_API_KEY যোগ করুন।" });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: process.env.SKILL_SWAP_AI_MODEL || "gpt-4.1-mini",
        store: false,
        max_output_tokens: 400,
        // Skill Swap product guide v2
        instructions: "You are the in-app assistant for Skill Swap, a student skill exchange platform.\nUse the product guide below for platform questions. If a detail is unknown, say so. Give concise steps and use the user's language. For Romanized Bengali, reply in Bengali script.\nLearn Skills: open Explore Skills (#explore), browse published skill listings, select a listing, and check the available session or booking options shown there.\nTeach Skills: signed-in users can open the new skill listing page (#dashboard/new), enter the skill details and submit the listing. Account permissions can affect availability.\nSkill exchange: students can offer a skill they can teach and look for a skill they want to learn. Guide them to the relevant listings and dashboard.\nLearning rooms: session and meeting details can be available in the learning room. When an external meeting link is provided, use Open external meeting.\nCode Relay: open #arena/relay. Use the screen to create a room or join with a room code. Follow the room instructions to submit questions and solutions where requested, solve within the timer, and submit answers. Grading and review depend on the room settings. Never promise a specific mode or result.\nHelp: open #help for support. Mic turns speech into a question or command. Listen reads the latest reply aloud when browser speech output is available.\nYou can explain pages and workflows. You cannot see live bookings, user data, room state, or private files. Never claim you created a room, booked a session or performed an action. Page navigation runs in the browser through supported commands.\nFor coding or general knowledge, give a direct answer and a short example where useful. Reply in plain text.",
        input: question
      })
    });

    if (!response.ok) throw new Error("AI request failed");
    const result = await response.json();
    const answer = (result.output || []).flatMap(item => item.content || [])
      .filter(item => item.type === "output_text").map(item => item.text).join("\n").trim();
    if (!answer) throw new Error("Empty answer");
    return res.json({ answer });
  } catch {
    return res.status(502).json({ error: "AI উত্তর দিতে পারছে না। একটু পরে আবার চেষ্টা করুন।" });
  }
}