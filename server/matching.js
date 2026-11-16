export const normalizeSkill = (value) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const clock = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function matchStudents(mine, theirs, mySlots, theirSlots) {
  const offers = mine.filter((p) => p.kind === "teach"),
    wants = mine.filter((p) => p.kind === "learn");
  const give = offers.flatMap((o) =>
    theirs
      .filter(
        (t) => t.kind === "learn" && t.skill === o.skill && o.level >= t.level,
      )
      .map((t) => o.skill),
  );
  const receive = wants.flatMap((w) =>
    theirs
      .filter(
        (t) => t.kind === "teach" && t.skill === w.skill && t.level >= w.level,
      )
      .map((t) => w.skill),
  );
  const overlap = mySlots
    .flatMap((a) =>
      theirSlots
        .filter((b) => a.weekday === b.weekday)
        .map((b) => ({
          weekday: a.weekday,
          start_minute: Math.max(a.start_minute, b.start_minute),
          end_minute: Math.min(a.end_minute, b.end_minute),
        })),
    )
    .filter((x) => x.end_minute - x.start_minute >= 15);
  if (!give.length || !receive.length || !overlap.length) return null;
  const unique = [
    ...new Map(overlap.map((x) => [JSON.stringify(x), x])).values(),
  ];
  return {
    give: [...new Set(give)],
    receive: [...new Set(receive)],
    overlap: unique,
    score:
      60 +
      Math.min(20, (give.length + receive.length) * 5) +
      Math.min(20, unique.length * 5),
    explanations: [
      `You can teach ${[...new Set(give)].join(", ")} at their requested level.`,
      `They can teach ${[...new Set(receive)].join(", ")} at your requested level.`,
      ...unique.map(
        (x) =>
          `Both available ${days[x.weekday]} ${clock(x.start_minute)}–${clock(x.end_minute)} (Asia/Dhaka).`,
      ),
    ],
  };
}
