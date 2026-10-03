// The dashboard's title and the line under it.
export function dashboardHeading(options: {
  // The search box text, untrimmed. Any query turns the view into results.
  search: string;
  // The calm layout greets people on the My Drive root.
  greet: boolean;
  firstName: string;
  // True once the account is known to hold no files or folders, so a brand
  // new account is not told "Welcome back".
  isNewAccount: boolean;
  // Folder name or section title shown when not greeting.
  title: string;
}): string {
  if (options.search.trim()) return "Search results";
  if (!options.greet) return options.title;
  if (!options.firstName) return "Welcome to Dropvault";
  return options.isNewAccount
    ? `Welcome, ${options.firstName}`
    : `Welcome back, ${options.firstName}`;
}

export function dashboardSubtitle(options: {
  search: string;
  itemCount: number;
  firstName: string;
}): string {
  const query = options.search.trim();
  const n = options.itemCount;
  if (query) return `${n} result${n === 1 ? "" : "s"} for “${query}”`;
  const items = `${n} item${n === 1 ? "" : "s"}`;
  return options.firstName ? `${items} · ${options.firstName}'s vault` : items;
}
