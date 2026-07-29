const SPARSE_HISTORY_MIN_HOURS = 1;

export function shouldUseSparseHistorySampling(
  queryHours,
  currentUsesIdRange,
  oldTableExists,
  oldUsesIdRange
) {
  return queryHours > SPARSE_HISTORY_MIN_HOURS
    && currentUsesIdRange
    && (!oldTableExists || oldUsesIdRange);
}

function buildSampleJsonExpression(tableName, jsonColumns) {
  return `(
    SELECT json_object(${jsonColumns})
    FROM ${tableName}
    WHERE id >= ranges.start_id
      AND id < ranges.end_id
    ORDER BY id ASC
    LIMIT 1
  )`;
}

export function buildSparseHistoryQuery({
  columns,
  queryStart,
  queryEnd,
  firstRangeEnd,
  intervalMs,
  idPrefix,
  oldTableExists,
  tableBoundary
}) {
  const columnList = columns.split(',').map(column => column.trim()).filter(Boolean);
  const jsonColumns = ['timestamp', ...columnList]
    .flatMap(column => [`'${column}'`, column])
    .join(', ');
  const bindValues = [
    queryStart,
    firstRangeEnd,
    intervalMs,
    queryEnd,
    queryEnd,
    idPrefix,
    idPrefix
  ];
  const currentSample = buildSampleJsonExpression('metrics_history', jsonColumns);
  let sampleExpression = currentSample;

  if (oldTableExists) {
    const oldSample = buildSampleJsonExpression('metrics_history_old', jsonColumns);
    sampleExpression = `COALESCE(
        CASE WHEN ranges.range_start < ? THEN ${oldSample} END,
        CASE WHEN ranges.range_end > ? THEN ${currentSample} END
      )`;
    bindValues.push(tableBoundary, tableBoundary);
  }

  return {
    sql: `
      WITH RECURSIVE sample_ranges(range_start, range_end) AS (
        SELECT ?, ?
        UNION ALL
        SELECT
          range_end,
          MIN(range_end + ?, ?)
        FROM sample_ranges
        WHERE range_end < ?
      ),
      id_ranges AS (
        SELECT
          range_start,
          range_end,
          ? + CAST(
            substr(
              strftime(
                '%Y%m%d%H%M%S',
                CAST(range_start / 1000 AS INTEGER),
                'unixepoch'
              ),
              3
            ) AS INTEGER
          ) AS start_id,
          ? + CAST(
            substr(
              strftime(
                '%Y%m%d%H%M%S',
                CAST(range_end / 1000 AS INTEGER),
                'unixepoch'
              ),
              3
            ) AS INTEGER
          ) AS end_id
        FROM sample_ranges
      )
      SELECT ${sampleExpression} AS sample_json
      FROM id_ranges AS ranges
      ORDER BY ranges.range_start ASC
    `,
    bindValues
  };
}
