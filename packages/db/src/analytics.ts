/**
 * Page views, counted here.
 *
 * Small on purpose. This counts pages, not people: no cookies, no identifiers, nothing that would
 * make the site need a consent banner it does not have. Google Analytics is wired separately in
 * Settings for anyone who wants the fuller picture.
 */
import type { Db } from './client.ts';

/** One view of one page. Never allowed to fail a page render. */
export async function recordView(db: Db, host: string, path: string): Promise<void> {
  const cleanHost = (host || 'unknown').split(':')[0]!.slice(0, 120);
  // Query strings are dropped: they are search terms and session noise, not pages.
  const cleanPath = (path.split('?')[0] || '/').slice(0, 200);
  await db.query(
    `insert into page_view (day, host, path, views) values (current_date, $1, $2, 1)
     on conflict (day, host, path) do update set views = page_view.views + 1`,
    [cleanHost, cleanPath]
  );
}

export interface HostTotals {
  host: string;
  today: number;
  week: number;
  month: number;
  pages: number;
}

/** One row per host, so the main site and the subdomain are read side by side. */
export async function hostsSummary(db: Db, days = 30): Promise<HostTotals[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select host,
            sum(case when day = current_date then views else 0 end)::int as today,
            sum(case when day > current_date - 7 then views else 0 end)::int as week,
            sum(case when day > current_date - $1::int then views else 0 end)::int as month,
            count(distinct path)::int as pages
       from page_view
      group by host
      order by month desc, host`,
    [days]
  );
  return rows.map((r) => ({
    host: String(r.host),
    today: Number(r.today ?? 0),
    week: Number(r.week ?? 0),
    month: Number(r.month ?? 0),
    pages: Number(r.pages ?? 0),
  }));
}

export interface DayRow {
  day: string;
  host: string;
  views: number;
}

export async function dailyByHost(db: Db, days = 30): Promise<DayRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select to_char(day, 'YYYY-MM-DD') as day, host, views
       from (
         select day, host, sum(views)::int as views
           from page_view
          where day > current_date - $1::int
          group by day, host
       ) t
      order by day desc, host`,
    [days]
  );
  return rows.map((r) => ({ day: String(r.day), host: String(r.host), views: Number(r.views ?? 0) }));
}

export interface PageRow {
  host: string;
  path: string;
  views: number;
}

export async function topPages(db: Db, days = 30, limit = 25): Promise<PageRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select host, path, sum(views)::int as views
       from page_view
      where day > current_date - $1::int
      group by host, path
      order by views desc
      limit $2::int`,
    [days, limit]
  );
  return rows.map((r) => ({ host: String(r.host), path: String(r.path), views: Number(r.views ?? 0) }));
}

/** The hosts the site knows it is served on, for the "nothing yet" case. */
export const KNOWN_HOSTS = ['ozituma.com', 'learn.ozituma.com'];
