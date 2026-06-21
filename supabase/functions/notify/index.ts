// Maison Béthanie — push sender Edge Function
// Modes:
//   mode=daily   -> tomorrow reminders + today's events + monthly summary (run by cron each morning)
//   mode=new     -> instant "new booking" push (called by a DB trigger on insert)
//   mode=test    -> send a single test push to all devices
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") || "";
webpush.setVapidDetails("mailto:automindsolutions79@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sendToAll(payload: Record<string, unknown>) {
  const { data: subs } = await supa.from("push_subscriptions").select("id,subscription");
  let sent = 0;
  for (const row of subs ?? []) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supa.from("push_subscriptions").delete().eq("id", row.id);
    }
  }
  return sent;
}

const fmt = (n: number) => "RWF " + (Number(n) || 0).toLocaleString("en-US");

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const url = new URL(req.url);
  const mode = (body.mode as string) || url.searchParams.get("mode") || "daily";

  // light protection for trigger/cron calls
  if (NOTIFY_SECRET && (body.key as string) !== NOTIFY_SECRET && url.searchParams.get("key") !== NOTIFY_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  if (mode === "test") {
    const sent = await sendToAll({ title: "Maison Béthanie", body: "🔔 Test alert — push is working!", tag: "test", url: "./" });
    return Response.json({ ok: true, sent });
  }

  if (mode === "new") {
    const couple = (body.couple as string) || "A new event";
    const date = (body.date as string) || "";
    const sent = await sendToAll({ title: "New booking 💍", body: `${couple}${date ? " · " + date : ""}`, tag: "new-booking", url: "./" });
    return Response.json({ ok: true, sent });
  }

  if (mode === "receipt") {
    const sent = await sendToAll({ title: "🧾 Receipt issued", body: (body.message as string) || "A booking receipt was issued.", tag: "receipt-" + Date.now(), url: "./" });
    return Response.json({ ok: true, sent });
  }

  // mode = daily
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data: weds } = await supa.from("weddings").select("payload");
  const active = (weds ?? []).map((r) => r.payload).filter((w) => w.status !== "cancelled");
  const endOf = (w) => (w.endDate && w.endDate > w.date ? w.endDate : w.date);
  let sent = 0;

  for (const w of active.filter((w) => w.date === tomorrow))
    sent += await sendToAll({ title: "Wedding tomorrow 💍", body: `${w.couple}${w.hall ? " · " + w.hall : ""} (${w.date})`, tag: "rem-" + w.id, url: "./" });

  for (const w of active.filter((w) => w.date <= today && endOf(w) >= today && w.status !== "done"))
    sent += await sendToAll({ title: "Event today 💍", body: `${w.couple}${w.hall ? " · " + w.hall : ""}`, tag: "today-" + w.id, url: "./" });

  const curKey = today.slice(0, 7);

  // overdue rent — nudge on days 1, 5, 10, 15, 20, 25 of the month
  const dom = new Date().getDate();
  if (dom === 1 || dom % 5 === 0) {
    const tenants = (weds ?? []).map((r) => r.payload).filter((w) => w.kind === "motel" && w.status !== "ended");
    for (const r of tenants) {
      const paidM = (r.payments ?? []).filter((p) => (p.month || "") === curKey).reduce((x, p) => x + (+p.amount || 0), 0);
      const owes = Math.max(0, (+r.rent || 0) - paidM);
      if (owes > 0) sent += await sendToAll({ title: "💸 Rent due", body: `${r.tenant} · ${r.unit} owes ${fmt(owes)} this month`, tag: "rentdue-" + r.id, url: "./" });
    }
  }

  const income = active.reduce((a, w) => a + (w.payments ?? []).filter((p) => (p.date || "").slice(0, 7) === curKey).reduce((x, p) => x + (+p.amount || 0), 0), 0);
  const upcoming = active.filter((w) => endOf(w) >= today && w.status !== "done").length;
  if (body.summary !== false)
    sent += await sendToAll({ title: "Maison Béthanie — daily summary", body: `${upcoming} upcoming event(s) · ${fmt(income)} received this month`, tag: "daily-summary", url: "./" });

  return Response.json({ ok: true, sent });
});
