import type { PracticeResultSet } from "../../api/types";

/**
 * Renders a successful practice run's result set. Cells are already
 * strings (or `null` for SQL NULL) — `PracticeResultSet`'s own doc comment
 * explains why the backend stringifies everything itself, so this
 * component never parses/formats a cell, it only decides how `null` looks.
 *
 * A command with no columns (e.g. `CREATE TABLE`, `INSERT` without
 * `RETURNING`) has nothing to tabulate — shown as a one-line summary
 * instead of an empty table, which would look like a mistake rather than
 * "nothing to show".
 */
export function ResultTable({ result }: { result: PracticeResultSet }) {
  if (result.columns.length === 0) {
    return (
      <p className="muted-note">
        {result.command ?? "Команда"} выполнена{result.rowCount !== null && `, затронуто строк: ${result.rowCount}`}.
      </p>
    );
  }

  return (
    <div className="result-table-wrapper">
      <table className="result-table">
        <thead>
          <tr>
            {result.columns.map((column, columnIndex) => (
              // Positional index, not `column.name`: duplicate column names
              // are valid SQL (`select 1 as a, 2 as a`, per this file's own
              // doc comment above), so the name alone is not a unique key —
              // same reasoning the row/cell keys below already apply.
              <th key={columnIndex}>{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            // Rows have no stable id of their own (they're SQL query
            // output, not entities) — positional index is the only key
            // available, same tradeoff every ad-hoc SQL result grid makes.
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell === null ? <span className="result-null">NULL</span> : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && (
        <p className="muted-note">
          Показаны первые {result.rows.length} строк{result.rowCount !== null && ` из ${result.rowCount}`}.
        </p>
      )}
    </div>
  );
}
