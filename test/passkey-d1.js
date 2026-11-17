// D1's relevant prepared-statement interface backed by real SQLite.
// Tests using this fixture require Node 22.5+; application code does not.
export async function createPasskeyTestDb() {
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first(column) {
          const row = sqlite.prepare(sql).get(...params);
          if (!row) return null;
          return column ? row[column] : { ...row };
        },
        async all() {
          const results = sqlite.prepare(sql).all(...params).map(row => ({ ...row }));
          return { success: true, results, meta: { changes: results.length } };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close() { sqlite.close(); }
  };
}
