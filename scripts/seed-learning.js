export async function seedLearning(db) {
  const x = (
    await db.query(
      "SELECT e.* FROM exchanges e JOIN users a ON a.id=e.requester_id JOIN users b ON b.id=e.recipient_id WHERE a.email='student1@skillswap.test' AND b.email='student2@skillswap.test' ORDER BY e.id LIMIT 1",
    )
  ).rows[0];
  if (!x) return;
  for (const [sender, body, key] of [
    [
      x.requester_id,
      "Fictional demo: I will prepare a responsive page for our web design session.",
      "00000000-0000-4000-8000-000000000031",
    ],
    [
      x.recipient_id,
      "Fictional demo: Let us practice a clear three-minute project presentation.",
      "00000000-0000-4000-8000-000000000032",
    ],
  ])
    await db.query(
      "INSERT INTO learning_messages(exchange_id,sender_id,body,client_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [x.id, sender, body, key],
    );
  await db.query(
    "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [
      x.requester_id,
      "Your fictional demo exchange learning room is ready.",
      `dashboard/room/exchange/${x.id}`,
      "seed:learning-room-ready",
    ],
  );
}
