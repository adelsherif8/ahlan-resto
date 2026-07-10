// In-memory ops metrics — the "buffering is saving you money" strip.
const m = {
  messages_in: 0,
  bursts: 0,
  burst_msgs: 0,
  window_sum_ms: 0,
  spam_blocks: 0,
  faq_hits: 0,
  closer_hits: 0,
  llm_replies: 0,
  dead_letters: 0,
  started_at: new Date().toISOString(),
};

export function bump(key, by = 1) {
  if (key in m) m[key] += by;
}

export function metrics() {
  return {
    ...m,
    merge_ratio: m.bursts ? +(m.burst_msgs / m.bursts).toFixed(2) : 0,
    avg_window_ms: m.bursts ? Math.round(m.window_sum_ms / m.bursts) : 0,
    zero_llm_rate: m.bursts ? +(((m.faq_hits + m.closer_hits) / m.bursts) * 100).toFixed(1) : 0,
  };
}
