// JANITOR — hourly cleanup (port of the hotel's removebuffer.json, restaurant edition).
// Note: conversation freshness is enforced on READ (1h TTL in respond/load_history);
// the janitor keeps the tables small and kills strays.
import { defineFlow } from "../engine/flow.js";

const CONVERSATION_MAX_AGE_H = 24; // delete message_full rows idle > 24h (read-TTL already gives 1h freshness)
const BUFFER_MAX_AGE_MIN = 10;     // stray buffer rows older than 10 min = orphans
const QUEUE_MAX_AGE_H = 24;        // undeliverable queue items older than 24h are harmful to send

defineFlow({
  name: "janitor",
  description: "Hourly cleanup — archive idle conversations, purge stray buffers, drop stale retry queue",
  trigger: { icon: "timer", label: "Schedule (hourly) / manual run from ops" },
  nodes: [
    { id: "find_idle", label: "Find Idle Conversations", icon: "database" },
    { id: "purge_conversations", label: "Purge Conversations", icon: "filter" },
    { id: "purge_buffers", label: "Purge Stray Buffers", icon: "filter" },
    { id: "purge_queue", label: "Purge Stale Queue", icon: "filter" },
  ],

  async run(f, ctx) {
    const { db } = ctx.tenant;

    const idle = await f.node("find_idle", async () => {
      const cutoff = new Date(Date.now() - CONVERSATION_MAX_AGE_H * 3600_000).toISOString();
      const { data } = await db.from("message_full").select("phone_number,updated_at").lt("updated_at", cutoff);
      return { idle_conversations: (data || []).map((r) => r.phone_number), cutoff };
    }, { input: { max_age_hours: CONVERSATION_MAX_AGE_H } });

    await f.node("purge_conversations", async () => {
      if (!idle.idle_conversations.length) return { deleted: 0 };
      const { error } = await db.from("message_full").delete().in("phone_number", idle.idle_conversations);
      if (error) throw new Error(error.message);
      return { deleted: idle.idle_conversations.length };
    }, { input: { count: idle.idle_conversations.length } });

    await f.node("purge_buffers", async () => {
      const cutoff = new Date(Date.now() - BUFFER_MAX_AGE_MIN * 60_000).toISOString();
      const { data, error } = await db.from("messages_buffer").delete().lt("created_at", cutoff).select("id");
      if (error) throw new Error(error.message);
      return { deleted: data?.length || 0, older_than_min: BUFFER_MAX_AGE_MIN };
    }, { input: { max_age_min: BUFFER_MAX_AGE_MIN } });

    await f.node("purge_queue", async () => {
      const cutoff = new Date(Date.now() - QUEUE_MAX_AGE_H * 3600_000).toISOString();
      const { data, error } = await db.from("pending_message_queue").delete().lt("created_at", cutoff).select("id");
      if (error) throw new Error(error.message);
      return { deleted: data?.length || 0, reason: "a 'table ready' ping from yesterday must never send" };
    }, { input: { max_age_hours: QUEUE_MAX_AGE_H } });

    return { done: true };
  },
});
