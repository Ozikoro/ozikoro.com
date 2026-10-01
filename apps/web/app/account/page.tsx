import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/*
 * /account is now part of the dashboards.
 *
 * The owner: "https://ozituma.com/account should be part of the dashboards, instead of being
 * separate. all should be inside the dashboard, instead of looking just like the website."
 *
 * So the address still works for anyone who has it bookmarked or linked, and it lands them
 * inside the dashboard shell rather than on a page wearing the website's clothes. An
 * administrator is sent to their own dashboard, because that is where the account screen belongs
 * for them; everyone else goes to the contributor one.
 */
export default function Page() {
  redirect('/contribute/account');
}
