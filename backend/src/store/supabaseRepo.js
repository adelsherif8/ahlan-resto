// Supabase implementation of the repo interface used by all routes.
export function supabaseRepo(client) {
  return {
    async list(table, { where = {}, order, desc = true, limit } = {}) {
      let q = client.from(table).select("*");
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      if (order) q = q.order(order, { ascending: !desc });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw new Error(`${table} list: ${error.message}`);
      return data || [];
    },
    async get(table, id) {
      const { data, error } = await client.from(table).select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`${table} get: ${error.message}`);
      return data;
    },
    async insert(table, row) {
      const { data, error } = await client.from(table).insert(row).select().single();
      if (error) throw new Error(`${table} insert: ${error.message}`);
      return data;
    },
    async update(table, id, patch) {
      const { data, error } = await client.from(table).update(patch).eq("id", id).select().maybeSingle();
      if (error) throw new Error(`${table} update: ${error.message}`);
      return data;
    },
    async remove(table, id) {
      const { error } = await client.from(table).delete().eq("id", id);
      if (error) throw new Error(`${table} remove: ${error.message}`);
      return true;
    },
  };
}
