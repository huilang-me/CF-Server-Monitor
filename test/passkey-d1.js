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
        },
        executeBatch() {
          const results = sqlite.prepare(sql).all(...params).map(row => ({ ...row }));
          const changes = /^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)
            ? 0 : Number(sqlite.prepare('SELECT changes() AS count').get().count);
          return { success: true, results, meta: { changes } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        // D1 batches return rows for SELECT/RETURNING statements as well as
        // write metadata, and execute without interleaving another batch.
        const results = statements.map(statement => statement.executeBatch());
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
