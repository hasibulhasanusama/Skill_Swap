const fail = (status, message) => Object.assign(new Error(message), { status });
export async function assertNoConflict(
  c,
  {
    participants,
    starts_at,
    ends_at,
    ignoreBooking = 0,
    ignoreExchangeSession = 0,
  },
) {
  await c.query(
    "SELECT id FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
    participants,
  );
  const p = [...participants, starts_at, ends_at];
  const bookings = await c.query(
    "SELECT id FROM bookings WHERE status='reserved' AND id<>$5 AND (learner_id IN ($1,$2) OR mentor_id IN ($1,$2)) AND starts_at<$4 AND ends_at>$3",
    [...p, ignoreBooking],
  );
  const exchanges = await c.query(
    "SELECT s.id FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id WHERE e.status='active' AND s.id<>$5 AND (e.requester_id IN ($1,$2) OR e.recipient_id IN ($1,$2)) AND s.starts_at<$4 AND s.ends_at>$3",
    [...p, ignoreExchangeSession],
  );
  if (bookings.rows.length || exchanges.rows.length)
    throw fail(409, "A participant already has a session during this time.");
}
