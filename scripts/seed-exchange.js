export async function seedExchange(db) {
  const students = (
    await db.query("SELECT * FROM users WHERE role='student' ORDER BY id")
  ).rows;
  const pairs = [
    ["web design", "public speaking"],
    ["public speaking", "web design"],
    ["python", "illustration"],
    ["illustration", "python"],
    ["english", "spreadsheets"],
    ["spreadsheets", "english"],
    ["sql", "web design"],
  ];
  for (let i = 0; i < Math.min(7, students.length); i++) {
    for (const [kind, skill, level] of [
      ["teach", pairs[i][0], 3],
      ["learn", pairs[i][1], 1],
    ])
      await db.query(
        "INSERT INTO skill_preferences(user_id,skill,kind,level) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [students[i].id, skill, kind, level],
      );
    for (const weekday of [2, 4, 6])
      await db.query(
        "INSERT INTO exchange_availability(user_id,weekday,start_minute,end_minute) VALUES($1,$2,1080,1260) ON CONFLICT DO NOTHING",
        [students[i].id, weekday],
      );
  }
  if (students.length >= 2) {
    const a = students[0].id,
      b = students[1].id;
    const existing = (
      await db.query(
        "SELECT id FROM exchanges WHERE requester_id=$1 AND recipient_id=$2",
        [a, b],
      )
    ).rows;
    if (!existing.length) {
      const x = (
        await db.query(
          "INSERT INTO exchanges(requester_id,recipient_id,requester_skill,recipient_skill,message,status,requester_objective,recipient_objective,requester_accepted,recipient_accepted,revision) VALUES($1,$2,'web design','public speaking','Fictional demo exchange for practicing complementary skills.','active','Build and explain a responsive personal homepage.','Deliver a clear three-minute project presentation.',true,true,1) RETURNING id",
          [a, b],
        )
      ).rows[0];
      // Seed one future session in each direction; completion remains unrecorded.
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 7);
      start.setUTCHours(12, 0, 0, 0);
      for (const [i, teacher] of [a, b].entries()) {
        const begins = new Date(start.getTime() + i * 86400000);
        await db.query(
          "INSERT INTO exchange_sessions(exchange_id,teacher_id,starts_at,ends_at) VALUES($1,$2,$3,$4)",
          [
            x.id,
            teacher,
            begins.toISOString(),
            new Date(begins.getTime() + 3600000).toISOString(),
          ],
        );
      }
    }
  }
}
