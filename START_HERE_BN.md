# Skill Swap — এখান থেকে শুরু করো

এটি ধাপ ১–৭ একসঙ্গে থাকা সর্বশেষ প্রজেক্ট। **শুধু এই ZIP ব্যবহার করবে; আগের ZIP-এর কোড মেশাতে হবে না।**

প্রথমবার `skill-swap` folder-এ PowerShell খুলে:

```powershell
npm ci
npm run setup
```

PostgreSQL চালু করে `.env`-এ DATABASE_URL ঠিক করো। Docker থাকলে database চালাতে `docker compose up -d db` দিতে পারো। তারপর:

```powershell
npm run db:migrate
npm run db:seed
npm start
```

Browser-এ http://localhost:3000 খুলবে। Demo admin: `admin@skillswap.test`; শিক্ষার্থী: `student1@skillswap.test` থেকে `student8@skillswap.test`। সবার demo password: `StudentDemo!2026`। সব তথ্য কাল্পনিক; টাকা লেনদেন simulated।

আগে চালু করে থাকলে পুরোনো server বন্ধ করে database/uploads backup নাও। নতুন ZIP আলাদা folder-এ extract করে সেখানে চালাও:

```powershell
node scripts/upgrade.js --from "C:\তোমার-পুরোনো-folder\skill-swap"
npm ci
npm run db:migrate
npm start
```

Path তোমার আসল পুরোনো project-এর path দিয়ে বদলাবে। পুরোনো .env, uploads ও database রেখে কাজ হবে; reset বা seed জরুরি নয়।

এই ধাপে নিরাপদ setup, প্রথম admin তৈরির command, health checks, Docker files, disposable test demo এবং backup/restore নির্দেশনা যোগ হয়েছে। বিস্তারিত `docs/OPERATIONS.md`-এ।

**৯৬টি automated test পাস করেছে।** ডেস্কটপ public preview দেখা হয়েছে। Automated browser tests চালানোর চেষ্টা Chromium launch restriction-এ আটকে গেছে; authenticated/mobile flow পাস দাবি করা হচ্ছে না। PostgreSQL persistent sessions/concurrency, Docker build, restore ও live deployment এই পরিবেশে পরীক্ষা হয়নি। Production email ও real payment integration নেই।

পরিকল্পনার সাত ধাপের code এখন এক ZIP-এ আছে। বাকি যাচাইয়ের তালিকা `docs/VERIFICATION.md`-এ; এটিকে পুরোপুরি পরীক্ষিত production release ধরে ব্যবহার করবে না।
