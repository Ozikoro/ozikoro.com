import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Search, UserRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { OzikoroMark } from "@/components/ozikoro-mark";

const nav = [
  ["/", "Academy"], ["/explore", "Explore"], ["/courses", "Courses"], ["/paths", "Paths"], ["/programmes", "Programmes"],
  ["/instructors", "Instructors"], ["/resources", "Resources"], ["/my-learning", "My Learning"],
] as const;

export function AcademyShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#main" className="skip-link">Skip to content</a>
    <div className="bg-night text-on-night-muted text-xs"><div className="site-wrap flex min-h-9 items-center justify-between gap-4 py-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1"><a className="top-link" href="https://ozikoro.com">ozikoro.com — archive & research</a><a className="top-link" href="https://ozituma.com">ozituma.com — dictionary</a><span className="border-b-2 border-gold pb-0.5 font-bold text-on-night">academy.ozikoro.com — learning</span></div>
      <span className="hidden uppercase tracking-caps sm:block">Ozi Ikoro Limited</span>
    </div></div>
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur"><div className="site-wrap flex min-h-20 items-center justify-between gap-6">
      <Link to="/" className="brand"><span className="brand-mark"><OzikoroMark className="ozikoro-mark" /></span><span><b>Ozikoro</b><small>Academy</small></span></Link>
      <nav className="hidden items-center gap-6 xl:flex" aria-label="Primary">{nav.map(([to,label])=><Link key={to} to={to} className={`nav-link ${path===to?'nav-active':''}`}>{label}</Link>)}</nav>
      <div className="hidden items-center gap-1 md:flex"><Button asChild variant="ghost" size="icon" aria-label="Search"><Link to="/search"><Search /></Link></Button><Button asChild variant="ghost" className="font-semibold"><Link to="/onye-ozi">Onye Ozi</Link></Button><Button asChild size="sm"><Link to="/account"><UserRound/> Sign in</Link></Button></div>
      <Button variant="ghost" size="icon" className="xl:hidden" onClick={()=>setOpen(!open)} aria-label="Toggle navigation">{open?<X/>:<Menu/>}</Button>
    </div>{open&&<nav className="site-wrap grid gap-1 border-t border-border py-4 xl:hidden">{nav.map(([to,label])=><Link key={to} to={to} onClick={()=>setOpen(false)} className="mobile-nav">{label}</Link>)}<Link to="/onye-ozi" className="mobile-nav">Onye Ozi</Link><Link to="/search" className="mobile-nav">Search</Link><Link to="/account" className="mobile-nav">Sign in</Link></nav>}</header>
    <main id="main">{children}</main>
    <footer className="bg-night py-14 text-on-night"><div className="site-wrap grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]"><div><Link to="/" className="brand brand-inverse"><span className="brand-mark"><OzikoroMark className="ozikoro-mark" /></span><span><b>Ozikoro</b><small>Academy</small></span></Link><p className="mt-5 max-w-sm font-serif text-base leading-relaxed text-on-night-muted">Structured learning in Igbo language, African history and cultural scholarship.</p></div><FooterCol title="Study" links={[["/explore","Knowledge Atlas"],["/courses","Courses"],["/programmes","Programmes"],["/paths","Learning paths"],["/my-learning","My Learning"],["/mastery","Mastery"]]}/><FooterCol title="Academy" links={[["/instructors","Instructors"],["/classroom","Classrooms"],["/timeline","Timeline"],["/map","Map"],["/compare","Compare cultures"],["/resources","Resources"],["/onye-ozi","Onye Ozi"]]}/><div><p className="footer-title">Independent tools</p><a className="footer-link" href="https://ozituma.com">Ozituma Dictionary ↗</a><a className="footer-link" href="https://ndebe.org">Ńdébé Script ↗</a></div></div><div className="site-wrap mt-12 border-t border-night-rule pt-5 text-xs text-on-night-muted">© 2026 Ozi Ikoro Limited. Knowledge carried forward.</div></footer>
  </div>
}
function FooterCol({title,links}:{title:string;links:readonly (readonly [string,string])[]}) { return <div><p className="footer-title">{title}</p>{links.map(([to,label])=><Link key={to} to={to} className="footer-link">{label}</Link>)}</div> }
