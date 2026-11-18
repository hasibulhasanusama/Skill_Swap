# Skill Swap — Skill Arena Update

আপনার দেওয়া Skill_Swap(2).zip-এর বর্তমান design, loading screen, profile, notification, support chat এবং service cards রেখে তিনটি game যুক্ত করা হয়েছে।

## আপনার চালু project-এ বসানো

1. Server যে terminal-এ চলছে সেখানে **Ctrl + C** দিন।
2. এই update ZIP extract করুন। ভিতরে `INSTALL_ARENA.ps1`, `changed-files.json` ও `skill-swap` folder পাবেন।
3. আপনার বর্তমান project-এর PowerShell terminal থেকে installer চালান। উদাহরণ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\Skill_Swap_Games_Update\INSTALL_ARENA.ps1" -ProjectPath "C:\Users\YOU TECH BD\Desktop\skill-swap"
```

`C:\path\to\...`-এর জায়গায় extracted installer-এর আসল path দিন। Installer শুধু update-এর প্রয়োজনীয় files copy করবে; আগে replaced files-এর timestamped backup করবে। আপনার `.env`, database, uploaded documents ও storage মুছবে না। Migration 012 আগে থেকে ভিন্ন content-এ থাকলে installer থামবে।

4. Project folder-এ চালান:

```powershell
npm install
npm run db:migrate
npm run test:arena
npm start
```

5. Browser-এ **Ctrl + F5** দিন। Home-এর নিচে **Turn practice into play** section-এ তিনটি game card দেখাবে। Dashboard-এ **Skill Arena & Results** link আছে। সরাসরি `http://localhost:3000/#arena` খোলা যাবে।

পুরো updated source-ও `skill-swap` folder-এ আছে। Existing project update করার জন্য installer ব্যবহার করাই সহজ। পুরোনো applied SQL migration edit বা database seed আবার করার দরকার নেই।

## প্রথমবার Detective চালানো

- Superadmin account দিয়ে sign in করুন।
- Dashboard → **Game PDF Library** অথবা `#arena/admin` খুলুন।
- **Install sample PDFs** চাপুন। Coding, English ও Design-এর তিনটি original study PDF এবং question bank যুক্ত হবে। বারবার চাপলেও duplicate হবে না। এই কাজটিও শুধু administrator করতে পারবেন।
- অথবা নিজের PDF upload করুন (সর্বোচ্চ ৫ MB), question bank লিখুন/AI draft তৈরি করুন, answer ও page reference যাচাই করে Publish করুন।
- অন্য student PDF upload, AI generate বা draft PDF দেখতে পারবে না। Delegate করতে Roles & Access-এ `arena.manage` permission দিন; student role-এ এটি প্রযোজ্য নয়।

## ১. Skill Detective

- Category-ভিত্তিক admin PDF; Solo, Bot ও Friends mode।
- Study সময় এবং round-এর timer নিজে নির্ধারণ।
- Solo/Bot: published PDF question bank থেকে tasks; choices random order-এ আসে। Source admin/manual হলে AI বলে দেখানো হয় না।
- Friends: প্রত্যেকে একটি ভুল-খোঁজার প্রশ্ন, ৪টি choice, correct answer, hint, explanation ও PDF page দেয়। নিজের প্রশ্নে নিজে খেলতে পারে না। প্রত্যেকে সমান একবার setter হয়।
- Correct +10, wrong −3, hint নিয়ে correct +5, no answer 0।
- Task report করা এবং host-এর reason দিয়ে unfair round void করার ব্যবস্থা।
- Bot difficulty simulated accuracy নিয়ন্ত্রণ করে। Bot-কে UI-তে bot হিসেবেই চিহ্নিত করা হয়।

### প্রকৃত AI প্রশ্ন

`ARENA_SETUP.env.example` থেকে `OPENAI_API_KEY` এবং প্রয়োজনে model আপনার existing `.env`-এ যোগ করে restart করুন। Admin **Generate AI draft from PDF** চাপলে ওই PDF configured OpenAI service-এ পাঠানো হয়। Question bank draft হিসেবেই save হয়; publish-এর আগে admin review আবশ্যক।

API key বা network না থাকলে AI generation চালু বলে দেখানো হয় না। Admin-authored question bank দিয়ে game পুরো খেলা যায়। ChatGPT subscription থেকে কোনো API key নেওয়া হয় না; নিজের server API configuration লাগবে। এই update তৈরির সময়ে live AI API call করা হয়নি; request adapter ও integration mocked service দিয়ে পরীক্ষা করা হয়েছে।

## ২. Code Relay

- ২–৪ জন friends room, shared room code, Ready lobby, countdown, room chat।
- Room-এর language নির্ধারণ; প্রত্যেকে problem, input/output test cases ও reference solution দেয়।
- প্রত্যেকে একবার setter; বাকি সবাই code submit করে। Setter নিজের round-এর points পায় না।
- Runner ছাড়া: code save হয়; question setter 0–100 score ও written feedback দেয়। এটি **setter review** হিসেবে report-এ দেখা যায়। কোনো fabricated automatic accuracy দেখানো হয় না; accuracy column-এ setter-এর rubric score প্রদর্শিত হয়।
- Runner থাকলে: server configured Judge0-compatible sandbox-এ tests চালায়। নম্বর = passed tests-এর percentage। Reference solution-এর সব test pass না করলে problem গ্রহণ হয় না।
- Language text হিসেবে যেকোনো নাম ব্যবহার করা যায়; automatic execution শুধু configured runner-এর supported language IDs-এর জন্য। Runner না থাকলে সব language-ই manual review mode-এ থাকে।
- Timeout হলেও সময়মতো জমা দেওয়া code-এর pending grading শেষ না হওয়া পর্যন্ত next round বন্ধ থাকে। Invalid/unreviewable round host void করতে পারেন।
- Student code এই website-এর Node/Express process-এ eval/exec করা হয় না।

### Automatic runner configuration

Existing `.env`-এ `ARENA_JUDGE_URL`, প্রয়োজনে `ARENA_JUDGE_TOKEN` বা `ARENA_JUDGE_RAPID_KEY` যোগ করুন। Base URL-এ `/submissions` যোগ করবেন না। Server restart করুন। Question form-এ runner language বেছে নিন। এই update-এর automatic grading adapter mocked service দিয়ে পরীক্ষা করা হয়েছে; আপনার runner credentials/network দিয়ে আলাদা smoke test লাগবে।

## ৩. TypeSprint

- Solo, Bot ও Friends (২–৪ জন)।
- English, Bangla বা code passage; চাইলে custom passage। সব participant একই round-এর একই passage পায়।
- Timer, multiple rounds, live progress, correct/wrong character highlight, WPM ও final-text accuracy।
- পুরো passage নিখুঁতভাবে শেষ হলে automatic final submit; নতুবা নিজে final submit করা যায়। Timeout-এ server-এ শেষ saved progress থেকে result হয়।
- WPM = সঠিক Unicode character / ৫ / elapsed minutes। Final-text accuracy corrected keystroke history গণনা করে না।
- Points = correct characters × accuracy ratio; নিখুঁত completion-এ ছোট time bonus। শুধু দ্রুত ভুল লেখা বাড়তি সুবিধা পায় না।
- Easy/Medium/Hard bot = 20/40/65 WPM simulated opponent। এটি generative AI নয়।
- Paste/drop বন্ধ এবং অস্বাভাবিক input-rate server reject করে। এটি competition demo protection; proctored exam বা tamper-proof typing assessment নয়।

## Report, Winner Certificate ও progress

- প্রত্যেক finished game account history-এ থাকে; reconnect/reload-এ room ফেরত পাওয়া যায়।
- Round breakdown, points, accuracy, hints, typing WPM, feedback ও leaderboard।
- **Download PDF report** সব participant নিজের account থেকে পাবে।
- **Winner Certificate** শুধু প্রথম স্থান পাওয়া human player, positive score এবং competition mode-এর জন্য। Solo practice-এ certificate হয় না; bot জিতলে human certificate পায় না।
- Tie-break: points → accuracy → lowest total answer time। সব সমান হলে rematch দরকার; certificate হয় না।
- Certificate user/room-bound, unique ID-সহ real downloadable PDF। এটি Skill Swap game achievement, accredited qualification নয়।
- Report তৈরি হলে notification bell-এ event যায়। Existing bell polling অনুসারে badge update হয়।

## Live behaviour

Room state server-authoritative PostgreSQL JSONB-তে save হয়; timer server time ধরে। UI প্রায় ২.৫ সেকেন্ডে room refresh করে এবং typing progress প্রায় ১.৪ সেকেন্ডে পাঠায়। এটি polling-based live room, WebSocket নয়। Form/input প্রতি poll-এ reset হয় না।

Host disconnect হলে ৯০ সেকেন্ড পর অন্য participant **Take over disconnected host** করতে পারে। Save & leave করে একই account-এর arena history থেকে rejoin করা যায়। Lobby ছাড়া নতুন player ঢুকতে পারে না।

Friends-দের একই backend/database ব্যবহার করতে হবে। আলাদা কম্পিউটারের `localhost` এক server নয়। Deploy করা URL বা অনুমোদিত LAN server প্রয়োজন।

## পরীক্ষা

```powershell
npm run test:arena
npm run check
```

এই release-এর game/API/DOM tests-এর বিস্তারিত `ARENA_TEST_RESULTS.md`-এ আছে। Existing old test suite-এর verification/exchange assertions-এর কয়েকটি uploaded ZIP-এর বর্তমান behaviour-এর সঙ্গে আগেই মেলে না; ওই পুরোনো tests ইচ্ছামতো বদলে সব pass দেখানো হয়নি।

## ব্যবহৃত integration documentation

- [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Judge0 CE API](https://ce.judge0.com/)
