// Server actions POST to the invoking page's route, and the admin page is a
// client component, so the segment config must live here: the Sleeper player
// sync upserts ~4k rows against the remote DB and needs more than the default
// function duration.
export const maxDuration = 300;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
