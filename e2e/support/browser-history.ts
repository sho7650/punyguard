// Reads the profile's browser history, the store that chrome.history reads, straight from disk,
// so that no extension needs the history permission to check it.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Every URL in the profile's browser history. Chrome must be closed first: closing the browser
// writes the history out.
export function historyUrls(userDataDir: string): string[] {
  const database = new DatabaseSync(path.join(userDataDir, "Default", "History"), {
    readOnly: true,
  });
  try {
    return database
      .prepare("SELECT url FROM urls")
      .all()
      .map((row) => String(row["url"]));
  } finally {
    database.close();
  }
}
