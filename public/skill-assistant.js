const root = document.createElement("div");
root.className = "ss-ai-widget";
root.innerHTML = `
  <button type="button" class="ss-ai-launcher" aria-label="Skill Swap AI"
          aria-expanded="false" aria-controls="ss-ai-chat">AI</button>
  <section class="ss-ai-chat" id="ss-ai-chat" aria-label="Skill Swap AI" hidden>
    <div class="ss-ai-row"><strong>Skill Swap AI</strong><button type="button" data-close aria-label="বন্ধ করুন">×</button></div>
    <div class="ss-ai-log" role="log" aria-live="polite"></div>
    <form>
      <div class="ss-ai-row">
        <input name="message" aria-label="প্রশ্ন বা কমান্ড" placeholder="প্রশ্ন বা কমান্ড লিখুন" maxlength="1200" required>
        <button type="submit">পাঠান</button>
      </div>
      <div class="ss-ai-row">
        <select aria-label="ভয়েসের ভাষা"><option value="bn-BD">বাংলা</option><option value="en-US">English</option></select>
        <button type="button" data-mic>মাইক</button>
        <button type="button" data-read>শুনুন</button>
      </div>
    </form>
    <div role="status"></div>
  </section>`;
document.body.append(root);

const launch = root.querySelector(".ss-ai-launcher");
const panel = root.querySelector(".ss-ai-chat");
const log = root.querySelector(".ss-ai-log");
const form = root.querySelector("form");
const field = form.elements.message;
const send = form.querySelector('[type="submit"]');
const status = root.querySelector('[role="status"]');
const mic = root.querySelector("[data-mic]");
const language = root.querySelector("select");
let x = innerWidth - 76, y = innerHeight - 76;
let gesture, moved = false, busy = false, lastAnswer = "";

function place() {
  x = Math.max(8, Math.min(x, innerWidth - launch.offsetWidth - 8));
  y = Math.max(8, Math.min(y, innerHeight - launch.offsetHeight - 8));
  launch.style.left = `${x}px`;
  launch.style.top = `${y}px`;
  if (panel.hidden) return;
  const left = Math.min(x, innerWidth - panel.offsetWidth - 8);
  const top = y > innerHeight / 2 ? y - panel.offsetHeight - 8 : y + launch.offsetHeight + 8;
  panel.style.left = `${Math.max(8, left)}px`;
  panel.style.top = `${Math.max(8, Math.min(top, innerHeight - panel.offsetHeight - 8))}px`;
}

function toggle(open) {
  panel.hidden = !open;
  launch.setAttribute("aria-expanded", String(open));
  place();
  (open ? field : launch).focus();
}

place();
window.addEventListener("resize", place);
if ("ResizeObserver" in window) new ResizeObserver(place).observe(panel);

launch.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  moved = false;
  gesture = { id: event.pointerId, x, y, left: event.clientX, top: event.clientY };
  launch.setPointerCapture(event.pointerId);
});
launch.addEventListener("pointermove", event => {
  if (event.pointerId !== gesture?.id) return;
  const dx = event.clientX - gesture.left;
  const dy = event.clientY - gesture.top;
  if (!moved && Math.hypot(dx, dy) < 6) return;
  moved = true;
  x = gesture.x + dx;
  y = gesture.y + dy;
  place();
});
launch.addEventListener("lostpointercapture", () => { gesture = undefined; });
launch.addEventListener("click", event => {
  if (event.detail === 0 || !moved) toggle(panel.hidden);
  moved = false;
});
root.querySelector("[data-close]").onclick = () => toggle(false);
panel.addEventListener("keydown", event => { if (event.key === "Escape") toggle(false); });

const pages = new Map([
  ["learn", "#explore"], ["learn skills", "#explore"], ["explore skills", "#explore"],
  ["লার্ন", "#explore"], ["লার্ন স্কিলস", "#explore"], ["শেখার পেজ", "#explore"],
  ["teach", "#dashboard/new"], ["teach skills", "#dashboard/new"], ["টিচ স্কিলস", "#dashboard/new"],
  ["code relay", "#arena/relay"], ["কোড রিলে", "#arena/relay"],
  ["home", "#home"], ["হোম", "#home"], ["help", "#help"], ["হেল্প", "#help"]
]);

function addMessage(author, text) {
  const line = document.createElement("p");
  line.textContent = `${author} · ${text}`;
  line.dataset.sender = author === "AI" ? "bot" : "user";
  log.append(line);
  log.scrollTop = log.scrollHeight;
}

addMessage("AI", "স্কিল বা সাধারণ জ্ঞানের প্রশ্ন করুন। পেজ খুলতে বলুন ‘Learn file khule deo’।");

async function submit(text) {
  // Skill Swap navigation commands v2
  if (!busy) {
    const command = text.trim().toLowerCase()
      .replace(/[,.!?\u0964]/gu, " ").replace(/\s+/gu, " ").trim();

    const pages = [
      [/^(?:code\s*(?:relay|delay|re lay)|\u0995\u09cb\u09a1\s+(?:\u09b0\u09bf\u09b2\u09c7|\u09a1\u09bf\u09b2\u09c7))$/iu, "#arena/relay"],
      [/^(?:learn(?: skills?| file| page)?|explore skills?|\u09b2\u09be\u09b0\u09cd\u09a8)$/iu, "#explore"],
      [/^(?:teach(?: skills?| page)?|\u099f\u09bf\u099a)$/iu, "#dashboard/new"],
      [/^(?:home(?: page)?|\u09b9\u09cb\u09ae)$/iu, "#home"],
      [/^(?:help(?: page)?|\u09b9\u09c7\u09b2\u09cd\u09aa)$/iu, "#help"]
    ];

    const target = command
      .replace(/^(?:game play korbo\s+)?(?:please\s+)?(?:(?:i want to\s+)?(?:open(?: koro| kore dao)?|play|launch)|go to|take me to)\s+/iu, "")
      .replace(/\s+(?:please|open koro|open kore dao|khule d(?:eo|ao|aw|in)|\u0996\u09c1\u09b2\u09c7\s*(?:\u09a6\u09be\u0993|\u09a6\u09bf\u09a8))$/iu, "")
      .trim();

    const page = pages.find(([name]) => name.test(target));
    if (page) {
      const input = document.querySelector('.ss-ai-panel input[name="message"], .ss-ai-chat input[name="message"]');
      if (input) input.value = "";
      toggle(false);
      window.location.hash = page[1];
      return;
    }
  }

  if (!text || busy) return;
  field.value = "";
  status.textContent = "";
  addMessage("আপনি", text);

  const command = text.toLowerCase().trim()
    .replace(/[.!?।]+$/u, "")
    .replace(/^(?:please\s+)?(?:open|go to)\s+/u, "")
    .replace(/\s*(?:খুলে\s*(?:দাও|দিন)|khul(?:e|ey)\s*(?:deo|dao|daw|den)|open koro)$/u, "")
    .replace(/\s+(?:file|page|ফাইল|পেজ)$/u, "").trim();

  const destination = pages.get(command);
  if (destination) {
    addMessage("AI", "পেজ খুলছি।");
    toggle(false);
    location.hash = destination;
    return;
  }

  busy = true;
  send.disabled = true;
  status.textContent = "উত্তর তৈরি হচ্ছে…";
  try {
    // Skill Swap chat CSRF
    const sessionResponse = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!sessionResponse.ok) throw new Error("Refresh the page and sign in again.");
    const session = await sessionResponse.json();
    if (!session.csrf) throw new Error("Session is not ready. Refresh and try again.");

    const response = await fetch("/api/skill-assistant/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf
      },
      body: JSON.stringify({ question: text })
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = response.status === 401 ? "AI চ্যাটের জন্য সাইন ইন করুন।" : result.error;
      return;
    }
    lastAnswer = result.answer;
    addMessage("AI", lastAnswer);
    status.textContent = "";
  } catch {
    status.textContent = "সংযোগ পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।";
  } finally {
    busy = false;
    send.disabled = false;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  void submit(field.value.trim());
});

mic.onclick = () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    status.textContent = "এই ব্রাউজারে ভয়েস ইনপুট নেই। লিখে পাঠান।";
    return;
  }
  if (busy) return;
  const recognition = new Recognition();
  recognition.lang = language.value;
  mic.disabled = true;
  recognition.onresult = event => void submit(event.results[0][0].transcript.trim().slice(0, 1200));
  recognition.onerror = () => { status.textContent = "মাইকের অনুমতি দেখে আবার চেষ্টা করুন।"; };
  recognition.onend = () => {
    mic.disabled = false;
    if (status.textContent === "শুনছি…") status.textContent = "";
  };
  try {
    recognition.start();
    status.textContent = "শুনছি…";
  } catch {
    mic.disabled = false;
    status.textContent = "মাইক চালু করা যায়নি।";
  }
};

root.querySelector("[data-read]").onclick = () => {
  if (!lastAnswer || !window.speechSynthesis) {
    status.textContent = "পড়ে শোনানোর জন্য আগে একটি উত্তর প্রয়োজন।";
    return;
  }
  const speech = new SpeechSynthesisUtterance(lastAnswer);
  speech.lang = /[\u0980-\u09ff]/u.test(lastAnswer) ? "bn-BD" : "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(speech);
};

/* Skill Swap bilingual chat */
{
  const panel = document.querySelector(".ss-ai-panel, .ss-ai-chat");
  const heading = panel?.firstElementChild;
  const language = panel?.querySelector("form select");
  const field = panel?.querySelector('input[name="message"]');
  const log = panel?.querySelector('[role="log"]');
  const close = panel?.querySelector("[data-close]");
  const mic = panel?.querySelector("[data-mic]");
  const read = panel?.querySelector("[data-read]");
  const send = panel?.querySelector('button[type="submit"]');

  if (heading && language && field && log && close && mic && read && send) {
    const copy = {
      "en-US": {
        placeholder: "Ask a question or type a command",
        send: "Send", mic: "Mic", read: "Listen", close: "Close chat",
        welcome: "Hi! Ask me about a skill or try “Open Learn Skills”.",
        you: "You", opening: "Opening the page…"
      },
      "bn-BD": {
        placeholder: "প্রশ্ন করুন বা কমান্ড লিখুন",
        send: "পাঠান", mic: "মাইক", read: "শুনুন", close: "চ্যাট বন্ধ করুন",
        welcome: "কোনো স্কিল নিয়ে প্রশ্ন করুন বা লিখুন ‘লার্ন খুলে দাও’।",
        you: "আপনি", opening: "পেজ খুলছি…"
      }
    };
    const statusLabels = new Map([
      // Translate assistant server messages
      ["\u09b8\u09be\u09b0\u09cd\u09ad\u09be\u09b0\u09c7\u09b0 .env \u09ab\u09be\u0987\u09b2\u09c7 OPENAI_API_KEY \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8\u0964", "Add OPENAI_API_KEY to the server's .env file."],
      ["\u09aa\u09cd\u09b0\u09b6\u09cd\u09a8\u09c7\u09b0 \u0989\u09a4\u09cd\u09a4\u09b0 \u099a\u09be\u09b2\u09c1 \u0995\u09b0\u09a4\u09c7 \u09b8\u09be\u09b0\u09cd\u09ad\u09be\u09b0\u09c7 OPENAI_API_KEY \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8\u0964", "Configure OPENAI_API_KEY on the server to enable AI answers."],
      ["AI \u0989\u09a4\u09cd\u09a4\u09b0 \u09a6\u09bf\u09a4\u09c7 \u09aa\u09be\u09b0\u099b\u09c7 \u09a8\u09be\u0964 \u098f\u0995\u099f\u09c1 \u09aa\u09b0\u09c7 \u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09c1\u09a8\u0964", "AI couldn't answer. Try again in a moment."],
      ["উত্তর তৈরি হচ্ছে…", "Thinking…"],
      ["শুনছি…", "Listening…"],
      ["AI চ্যাটের জন্য সাইন ইন করুন।", "Sign in to use AI chat."],
      ["AI চ্যাট ব্যবহার করতে সাইন ইন করুন।", "Sign in to use AI chat."],
      ["এই ব্রাউজারে ভয়েস ইনপুট নেই। লিখে পাঠান।", "Voice input is unavailable. Type your message below."],
      ["এই ব্রাউজারে ভয়েস ইনপুট নেই। কমান্ড লিখে পাঠান।", "Voice input is unavailable. Type your message below."],
      ["মাইকের অনুমতি দেখে আবার চেষ্টা করুন।", "Check microphone permissions and try again."],
      ["কথা বোঝা যায়নি। মাইকের অনুমতি দেখে আবার চেষ্টা করুন।", "I couldn't hear that. Check microphone permissions and try again."],
      ["মাইক চালু করা যায়নি।", "Couldn't start the microphone."],
      ["সংযোগ পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।", "Couldn't connect. Try again."],
      ["পড়ে শোনানোর জন্য আগে একটি উত্তর প্রয়োজন।", "Send a message to hear the reply."],
      ["শোনার জন্য একটি উত্তর ও ব্রাউজারের ভয়েস সুবিধা প্রয়োজন।", "A reply and browser speech support are required."]
    ]);

    const welcome = log.firstElementChild;
    const status = panel.querySelector('[role="status"]');
    const statusText = document.createElement("span");
    statusText.className = "ss-ai-status-translated";
    statusText.setAttribute("role", "status");
    if (status) {
      status.setAttribute("aria-hidden", "true");
      status.after(statusText);
    }

    language.setAttribute("aria-label", "Chat language / চ্যাটের ভাষা");
    heading.insertBefore(language, close);
    panel.classList.add("ss-ai-bilingual");

    function styleMessage(message) {
      const text = message.textContent;
      if (message === welcome) {
        message.dataset.sender = "bot";
        message.textContent = copy[language.value].welcome;
      } else if (text.startsWith("AI · ")) {
        message.dataset.sender = "bot";
        const body = text.slice("AI · ".length);
        message.textContent = /^(?:পেজ খুলছি।|.+ খুলছি।)$/u.test(body)
          ? copy[language.value].opening : body;
      } else if (text.startsWith("আপনি · ")) {
        message.dataset.sender = "user";
        message.setAttribute("aria-label", copy[language.value].you);
        message.textContent = text.slice("আপনি · ".length);
      }
    }

    function showStatus() {
      const text = status?.textContent || "";
      statusText.textContent = language.value === "en-US" ? statusLabels.get(text) || text : text;
    }

    function applyLanguage() {
      const labels = copy[language.value];
      panel.lang = language.value.slice(0, 2);
      field.placeholder = labels.placeholder;
      field.setAttribute("aria-label", labels.placeholder);
      send.textContent = labels.send;
      mic.textContent = labels.mic;
      read.textContent = labels.read;
      close.setAttribute("aria-label", labels.close);
      for (const message of log.children) styleMessage(message);
      showStatus();
    }

    if (status) {
      new MutationObserver(showStatus).observe(status, { childList: true, characterData: true, subtree: true });
    }
    new MutationObserver(records => {
      for (const record of records) {
        for (const message of record.addedNodes) {
          if (message.nodeType === 1) styleMessage(message);
        }
      }
      log.scrollTop = log.scrollHeight;
    }).observe(log, { childList: true });

    let savedLanguage;
    try { savedLanguage = localStorage.getItem("skillSwapChatLanguage"); } catch {}
    language.value = savedLanguage === "bn-BD" ? "bn-BD" : "en-US";
    language.addEventListener("change", () => {
      try { localStorage.setItem("skillSwapChatLanguage", language.value); } catch {}
      applyLanguage();
    });
    applyLanguage();
  }
}
